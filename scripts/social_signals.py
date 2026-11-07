"""
Social and news signals for any area: GDELT news + Reddit (Arctic Shift), geoparsed and rolled up to district x hour.

Run:   python -I scripts/social_signals.py --config scripts/social_areas/rasuwa-2026.json [--translate]
Test:  python -I scripts/social_signals.py --selftest
Needs: pandas (see scripts/requirements.txt). No API keys, except for --translate:
         --translate-provider openai (default): the `openai` SDK and OPENAI_API_KEY, from the environment or the repo's .env
         --translate-provider anthropic: the `anthropic` SDK and ANTHROPIC_API_KEY or an `ant auth login` profile
         --translate-provider stackai: a StackAI flow (STACKAI_API_KEY, optional STACKAI_FLOW_URL), standard library only
       Translations are cached in .cache/social/translations.json, so reruns only send new posts.

Location-agnostic: an area config names a country (ISO code), an optional bounding box, a time window, search terms and
subreddits. The gazetteer is the GeoNames dump for that country, so the same code works anywhere GeoNames covers.

Outputs, in data/social/<slug>/:
  items.csv         one row per kept article, post or comment: source, time (UTC), link, matched places, district, tags
  district_hour.csv district x hour (UTC, plus local time): news count, Reddit count, and one column per tag
  summary.json      counts, coverage and the caveats below
  feed.json         compact list for the app: time, source, excerpt, link, image, place coordinates, tags

Caveats, written into summary.json too:
  - GDELT's DOC API only searches roughly the last three months, and only article titles are matched to places here.
  - Reddit content comes via the Arctic Shift archive. Use it for inference and evaluation, not for training models;
    check Reddit's terms. Only IDs, links, short excerpts and derived fields are saved, not full post text.
  - Tags are a keyword baseline mapped to HumAID's categories (Alam et al., ICWSM 2021), NOT a trained HumAID model.
  - Translations (with --translate) are machine translations. The original text is always kept alongside.
  - Both signals rise after impact. They show where needs are, not early warning.
  - Sources are biased: GDELT toward national and international outlets, Reddit toward English-speaking, urban and
    diaspora users. Neither speaks for people in the affected area.
"""
import argparse, csv, io, json, re, time, urllib.error, urllib.parse, urllib.request, zipfile
from datetime import datetime, timedelta, timezone
from hashlib import sha1
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "social"
UA = {"User-Agent": "CascadeIQ-research-prototype/0.1"}
GDELT_WINDOW_DAYS = 85  # DOC 2.0 searches roughly the last three months; warn a little early

# ---------------- HTTP with cache and polite retries ----------------
def fetch(url: str, binary=False, wait=0.0, tries=6):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (sha1(url.encode()).hexdigest() + (".bin" if binary else ".txt"))
    if f.exists():
        return f.read_bytes() if binary else f.read_text()
    for attempt in range(tries):
        time.sleep(wait)
        try:
            body = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()
            text = body.decode("utf8", "replace")
            if not binary and text.lstrip().startswith("Please limit requests"):  # GDELT can rate-limit with a 200
                raise urllib.error.HTTPError(url, 429, "rate limited", None, None)
            (f.write_bytes(body) if binary else f.write_text(text))
            return body if binary else text
        except urllib.error.HTTPError as e:
            detail = (e.read().decode("utf8", "replace")[:200] if e.fp else "")
            print(f"  HTTP {e.code} (attempt {attempt + 1}): {detail}")
            if e.code not in (422, 429, 500, 502, 503, 504) or attempt == tries - 1:  # Arctic Shift returns 422 on server-side timeouts
                raise
            time.sleep(min(120, 15 * (attempt + 1)))
    raise RuntimeError(url)

# ---------------- gazetteer (GeoNames, any country) ----------------
KEEP_CODES = re.compile(r"^(ADM1|ADM2|ADM3|ADM4|PPL[A-Z0-9]*|STM|STMX|LK|LKS|RSV|GLCR|VAL|BDG|DAM)$")
HISTORICAL = re.compile(r"H$")
COMMON = set("nepal india china airport khola pani tara kura maidan madan gaun tole chowk bazaar bazar marg ganga lake temple valley the and for with from this that will have been were they them their there here help need water road roads river rivers bridge bridges flood floods rain market school hospital camp north south east west upper lower new old main city town village district park lake hill hills top base home people news post relief".split())
DEVANAGARI = re.compile(r"[ऀ-ॿ]")

def gazetteer(country: str, bbox):
    raw = fetch(f"https://download.geonames.org/export/dump/{country}.zip", binary=True)
    rows = zipfile.ZipFile(io.BytesIO(raw)).read(f"{country}.txt").decode("utf8").splitlines()
    adm2 = {}
    for line in fetch("https://download.geonames.org/export/dump/admin2Codes.txt").splitlines():
        code, name, ascii_, _ = line.split("\t")
        if code.startswith(country + "."):
            adm2[code] = ascii_ or name
    adm1 = {}
    for line in fetch("https://download.geonames.org/export/dump/admin1CodesASCII.txt").splitlines():
        code, name, ascii_, _ = line.split("\t")
        if code.startswith(country + "."):
            adm1[code] = ascii_ or name
    places, located = [], []
    for line in rows:
        c = line.split("\t")
        fcode, a1, a2 = c[7], c[10], c[11]
        if not KEEP_CODES.match(fcode) or HISTORICAL.search(fcode):
            continue
        lon, lat, pop = float(c[5]), float(c[4]), int(c[14] or 0)
        p = {"id": int(c[0]), "name": c[2] or c[1], "lon": lon, "lat": lat, "code": fcode, "pop": pop,
             "adm1": adm1.get(f"{country}.{a1}"), "adm2": adm2.get(f"{country}.{a1}.{a2}"),
             "inBox": bool(bbox) and bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]}
        names = {c[1], c[2]} | {n for n in c[3].split(",") if DEVANAGARI.search(n)}
        p["names"] = {n.strip() for n in names if len(n.strip()) >= 4 and n.strip().lower() not in COMMON}
        places.append(p)
        if p["adm2"]:
            located.append(p)
    # Features without a district (rivers, some lakes) take the district of the nearest place that has one.
    for p in places:
        if not p["adm2"] and located:
            q = min(located, key=lambda x: (x["lon"] - p["lon"]) ** 2 + (x["lat"] - p["lat"]) ** 2)
            p["adm2"], p["adm1"] = q["adm2"], p["adm1"] or q["adm1"]
    index = {}
    for p in places:
        for n in p["names"]:
            index.setdefault(n if DEVANAGARI.search(n) else n.lower(), []).append(p)
    return index

RANK = {"ADM2": 6, "ADM1": 5, "ADM3": 4, "PPLA": 4, "PPLA2": 4, "PPLC": 4, "STM": 3, "LK": 3, "GLCR": 3, "ADM4": 2}
WELL_KNOWN = re.compile(r"^(ADM1|ADM2|ADM3|PPLA\d?|PPLC|STM|GLCR)$")
def best(cands):
    """Prefer places inside the area box, then administrative areas and named rivers, then larger populations.
    Outside the box only well-known places count: a mention of 'Bhandari' is a surname far more often than a hamlet."""
    ok = [p for p in cands if p["inBox"] or WELL_KNOWN.match(p["code"]) or p["pop"] >= 5000]
    return max(ok, key=lambda p: (p["inBox"], RANK.get(p["code"], 1), p["pop"])) if ok else None

# How specific a place is, for placing an item on the map: a neighbourhood beats its district; a province is never a point.
SPECIFIC = lambda p: 0 if p["code"] == "ADM1" else 1 if p["code"] in ("ADM2", "VAL") else 2 if re.match(r"PPLA|PPLC|ADM3", p["code"]) else 3

TOKEN = re.compile(r"[ऀ-ॿ]+|[A-Za-z][A-Za-z'\-]*")
def geoparse(text: str, index):
    """Place mentions in text. ASCII names must start with a capital letter, which avoids most common-word clashes."""
    toks = [(m.group(0), m.start()) for m in TOKEN.finditer(text or "")]
    found, i = {}, 0
    while i < len(toks):
        hit = None
        for n in (3, 2, 1):  # longest match first: "Bhote Koshi" before "Koshi"
            words = [t for t, _ in toks[i:i + n]]
            if len(words) < n:
                continue
            phrase = " ".join(words)
            key = phrase if DEVANAGARI.search(phrase) else phrase.lower()
            if key in index and (DEVANAGARI.search(phrase) or phrase[0].isupper()):
                hit = (phrase, index[key], n)
                break
        if hit:
            phrase, cands, n = hit
            p = best(cands)
            if p is None:
                i += n
                continue
            found[p["id"]] = {"specific": SPECIFIC(p), "mention": phrase, "place": p["name"], "district": p["adm2"], "province": p["adm1"], "lon": p["lon"], "lat": p["lat"],
                              "inBox": p["inBox"], "ambiguous": len({c["adm2"] for c in cands}) > 1}
            i += n
        else:
            i += 1
    return list(found.values())

# ---------------- tags: keyword baseline on HumAID's categories ----------------
TAGS = {
    "infrastructure_and_utility_damage": r"\b(bridge|road|highway|power|electric|blackout|collaps|washed|damag|destroy|blocked|cut off|landslide)|सडक|पुल|बिजुली|पहिरो",
    "injured_or_dead_people": r"\b(dead|death|died|killed|bod(y|ies)|injur|casualt|toll)|मृत|घाइते",
    "missing_or_found_people": r"\b(missing|found alive|unaccounted|search for)|बेपत्ता",
    "displaced_people_and_evacuations": r"\b(evacuat|displac|shelter|relocat|camp|homeless)|विस्थापित",
    "requests_or_urgent_needs": r"\b(need|urgent|please help|send|food|water|medicine|supplies|blood)\b|सहयोग|खाना",
    "rescue_volunteering_or_donation_effort": r"\b(rescu|volunteer|donat|relief|fund|airlift|helicopter)|उद्धार|राहत",
    "caution_and_advice": r"\b(warn|alert|avoid|stay away|advis|caution|risk)|चेतावनी|सतर्क",
    "sympathy_and_support": r"\b(pray|condolence|thoughts|rip|heartbreak|stay safe)",
}
TAG_RE = {k: re.compile(v, re.I) for k, v in TAGS.items()}
def tag(text: str):
    return [k for k, r in TAG_RE.items() if r.search(text or "")]

# ---------------- sources ----------------
def gdelt(cfg):
    """Article list from GDELT DOC 2.0, in 6-hour slices so the 250-record cap rarely bites. Titles only."""
    start, end = parse(cfg["start"]), parse(cfg["end"])
    if (datetime.now(timezone.utc) - start).days > GDELT_WINDOW_DAYS:
        print(f"  GDELT: skipped. {cfg['start']} is older than the DOC API's ~3-month window. Use GDELT's raw GKG files or BigQuery for older events.")
        return [], "(skipped: outside the DOC API window)"
    places = " OR ".join(f'"{t}"' if " " in t else t for t in cfg["place_terms"])
    events = " OR ".join(f'"{t}"' if " " in t else t for t in cfg["event_terms"] if not DEVANAGARI.search(t))
    query = f"({places}) ({events})" if events else f"({places})"
    out, t, capped = [], start, 0
    while t < end:
        u = t + timedelta(hours=6)
        url = "https://api.gdeltproject.org/api/v2/doc/doc?" + urllib.parse.urlencode({
            "query": query, "mode": "artlist", "format": "json", "maxrecords": "250", "sort": "datedesc",
            "startdatetime": t.strftime("%Y%m%d%H%M%S"), "enddatetime": min(u, end).strftime("%Y%m%d%H%M%S")})
        body = fetch(url, wait=6)  # GDELT asks for one request every 5 seconds
        arts = json.loads(body).get("articles", []) if body.strip().startswith("{") else []
        capped += len(arts) >= 250
        for a in arts:
            out.append({"source": "news", "time": datetime.strptime(a["seendate"], "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc),
                        "url": a["url"], "title": a.get("title", ""), "text": a.get("title", ""), "outlet": a.get("domain", ""), "image": a.get("socialimage") or "",
                        "lang": a.get("language", ""), "sourceCountry": a.get("sourcecountry", "")})
        t = u
    if capped:
        print(f"  GDELT: {capped} slice(s) hit the 250-article cap, so news volume there is a lower bound.")
    seen, kept = set(), []
    for a in sorted(out, key=lambda a: a["time"]):  # syndication repeats stories: drop repeated URLs and titles
        key = (a["url"].split("?")[0], re.sub(r"\W+", " ", a["title"].lower()).strip())
        if key[0] in seen or key[1] in seen:
            continue
        seen.update(key)
        kept.append(a)
    return kept, query

def arctic(kind: str, sub: str, cfg):
    """All posts or comments in a subreddit for the window, oldest first, via the Arctic Shift archive."""
    after, end, rows = int(parse(cfg["start"]).timestamp()), int(parse(cfg["end"]).timestamp()), []
    for _ in range(500):
        url = f"https://arctic-shift.photon-reddit.com/api/{kind}/search?" + urllib.parse.urlencode(
            {"subreddit": sub, "after": after, "before": end, "limit": 100, "sort": "asc"})
        batch = json.loads(fetch(url, wait=0.5)).get("data") or []
        rows += batch
        if len(batch) < 100:
            break
        after = int(batch[-1]["created_utc"])
    return rows

def reddit(cfg, index):
    terms = re.compile("|".join(re.escape(t) for t in cfg["event_terms"]), re.I)  # must be about the event; places only locate it
    out = []
    for sub in cfg.get("subreddits", []):
        for kind in ("posts", "comments"):
            for r in arctic(kind, sub, cfg):
                text = (r.get("title", "") + "\n" + r.get("selftext", "")) if kind == "posts" else r.get("body", "")
                if not terms.search(text):
                    continue  # keep only items about the event or the area
                out.append({"source": "reddit", "time": datetime.fromtimestamp(int(r["created_utc"]), timezone.utc),
                            "url": "https://www.reddit.com" + (r.get("permalink") or f"/r/{sub}/comments/{r.get('link_id', '')[3:]}/_/{r['id']}"),
                            "title": r.get("title", ""), "text": text, "outlet": f"r/{sub} {kind[:-1]}", "lang": "", "sourceCountry": "", "image": reddit_image(r)})
    return out

IMG = re.compile(r"\.(jpe?g|png|gif|webp)(\?|$)", re.I)
def reddit_image(r) -> str:
    """The post's image, if it has one: a direct image link, else the largest preview Reddit generated."""
    url = r.get("url_overridden_by_dest") or r.get("url") or ""
    if IMG.search(url) or "i.redd.it" in url:
        return url
    try:
        return r["preview"]["images"][0]["source"]["url"].replace("&amp;", "&")
    except (KeyError, IndexError, TypeError):
        return ""

# ---------------- translation: Claude detects the language and translates non-English posts ----------------
TRANSLATE_MODEL = "claude-opus-5-5"
TRANSLATE_BATCH = 25
TRANSLATE_CHARS = 1500  # long comments are cut here before sending, and the cut is noted in the request
TRANSLATION_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "string"}, "language": {"type": "string"}, "is_english": {"type": "boolean"}, "translation": {"type": "string"}},
        "required": ["id", "language", "is_english", "translation"], "additionalProperties": False}}},
    "required": ["items"], "additionalProperties": False,
}
TRANSLATE_SYSTEM = (
    "You translate social media posts about a disaster for an emergency-response dashboard. Responders will read your "
    "English to decide where help is needed, so accuracy matters more than style.\n"
    "For each item, name its language as people would say it, for example: English, Nepali (Devanagari), "
    "Nepali (romanized), or Nepali-English mix. If the text is entirely English, set is_english to true and translation "
    "to an empty string. Otherwise translate the whole text into plain English: keep place names, numbers, times and "
    "who-did-what exactly; keep the tone (including rudeness) without softening or amplifying it; don't add facts or "
    "explanations. Return exactly one entry per input id."
)

OPENAI_TRANSLATE_MODEL = "gpt-5.4-mini"  # override with --translate-model or OPENAI_TRANSLATE_MODEL

def env_key(name: str):
    """A key from the environment, else from the repo's .env. The value is never printed."""
    import os
    if os.environ.get(name):
        return os.environ[name]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            m = re.match(rf"\s*(?:export\s+)?{name}\s*=\s*(.*?)\s*$", line)
            if m and m.group(1).strip("\"'"):
                return m.group(1).strip("\"'")
    return None

def _user_prompt(context: str, payload) -> str:
    return f"Context: {context}\n\nItems (JSON):\n" + json.dumps(payload, ensure_ascii=False)

def _batch_openai(client, model: str, context: str, payload):
    """One batch through OpenAI Chat Completions with a strict JSON schema. Returns (items or None, problem)."""
    resp = client.chat.completions.create(
        model=model, max_completion_tokens=16000,
        messages=[{"role": "system", "content": TRANSLATE_SYSTEM}, {"role": "user", "content": _user_prompt(context, payload)}],
        response_format={"type": "json_schema", "json_schema": {"name": "translations", "strict": True, "schema": TRANSLATION_SCHEMA}},
    )
    choice = resp.choices[0]
    if getattr(choice.message, "refusal", None):
        return None, "declined"
    if choice.finish_reason == "length":
        return None, "hit the token limit"
    return json.loads(choice.message.content or "{}").get("items"), None

STACKAI_FLOW_URL = "https://api.stackai.com/inference/v0/run/778acca0-3920-4b29-9206-cca2fecc93cd/6aef82987d4c770f375b832b"

class StackAIClient:
    """Runs a StackAI flow: POST {"user_id": ..., "in-0": text} with a bearer key, as in StackAI's API snippet."""
    def __init__(self, key: str, url: str = STACKAI_FLOW_URL, user_id: str = ""):
        self.key, self.url, self.user_id = key, url, user_id
    def run(self, text: str) -> dict:
        req = urllib.request.Request(self.url, data=json.dumps({"user_id": self.user_id, "in-0": text}).encode(), method="POST",
                                     headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"})
        return json.loads(urllib.request.urlopen(req, timeout=300).read().decode("utf8"))

def _flow_text(result: dict) -> str:
    """The flow's text output. StackAI flows usually answer {"outputs": {"out-0": "..."}}; fall back to any text output."""
    outs = result.get("outputs") if isinstance(result, dict) else None
    if isinstance(outs, dict):
        if isinstance(outs.get("out-0"), str):
            return outs["out-0"]
        for v in outs.values():
            if isinstance(v, str):
                return v
    return result.get("out-0", "") if isinstance(result, dict) else ""

def _json_in(text: str):
    """The first JSON object in a model reply, ignoring code fences or prose around it."""
    start, end = text.find("{"), text.rfind("}")
    return json.loads(text[start:end + 1]) if start != -1 and end > start else None

def _batch_stackai(client, context: str, payload):
    """One batch through a StackAI flow. The flow has no schema enforcement, so the reply is checked item by item."""
    prompt = (TRANSLATE_SYSTEM + "\n\nReply with JSON only, no prose, in exactly this shape: "
              '{"items": [{"id": "...", "language": "...", "is_english": true, "translation": "..."}]}\n\n' + _user_prompt(context, payload))
    data = _json_in(_flow_text(client.run(prompt)))
    if not data or not isinstance(data.get("items"), list):
        return None, "returned no usable JSON (check the flow passes the prompt straight to its model)"
    ok = [it for it in data["items"] if isinstance(it, dict) and isinstance(it.get("id"), str) and isinstance(it.get("language"), str)
          and isinstance(it.get("is_english"), bool) and isinstance(it.get("translation"), str)]
    return ok, None

def _batch_anthropic(client, context: str, payload):
    """One batch through Claude with a JSON schema and automatic fallback on a declined request."""
    resp = client.beta.messages.create(
        model=TRANSLATE_MODEL, max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": TRANSLATION_SCHEMA}},
        system=TRANSLATE_SYSTEM, messages=[{"role": "user", "content": _user_prompt(context, payload)}],
    )
    if resp.stop_reason == "refusal":
        return None, "declined"
    if resp.stop_reason == "max_tokens":
        return None, "hit the token limit"
    return json.loads(next((b.text for b in resp.content if b.type == "text"), "{}")).get("items"), None

def translate(texts, context: str, provider: str = "openai", model: str | None = None, client=None):
    """Language + English translation for each text, keyed by a hash of the text. Cached on disk across runs.
    The original text is never replaced: callers keep it and add the translation next to it."""
    cache_file = CACHE / "translations.json"
    CACHE.mkdir(parents=True, exist_ok=True)
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    keyed = {sha1(t.encode()).hexdigest()[:16]: t for t in texts if t and t.strip()}
    todo = [(k, t) for k, t in keyed.items() if k not in cache]
    if not todo:
        return cache
    model = model or {"openai": OPENAI_TRANSLATE_MODEL, "anthropic": TRANSLATE_MODEL, "stackai": "flow"}[provider]
    if client is None:
        try:
            if provider == "stackai":
                key = env_key("STACKAI_API_KEY")
                if not key:
                    print("  translate: skipped. No STACKAI_API_KEY in the environment or .env.")
                    return cache
                import os
                client = StackAIClient(key, os.environ.get("STACKAI_FLOW_URL") or STACKAI_FLOW_URL)
            elif provider == "openai":
                from openai import OpenAI
                key = env_key("OPENAI_API_KEY")
                if not key:
                    print("  translate: skipped. No OPENAI_API_KEY in the environment or .env.")
                    return cache
                client = OpenAI(api_key=key)
            else:
                import anthropic
                client = anthropic.Anthropic()  # ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile
        except Exception as e:  # missing SDK: keep going without translations
            print(f"  translate: skipped ({type(e).__name__}: {e}).")
            return cache
    by = {"openai": f"OpenAI {model}", "anthropic": f"Claude ({model})", "stackai": "a StackAI flow"}[provider]
    print(f"  translate: {by}, {len(todo)} new texts in {(len(todo) + TRANSLATE_BATCH - 1) // TRANSLATE_BATCH} request(s), {len(keyed) - len(todo)} cached")
    for i in range(0, len(todo), TRANSLATE_BATCH):
        chunk = todo[i:i + TRANSLATE_BATCH]
        payload = [{"id": k, "text": t[:TRANSLATE_CHARS], **({"note": "text cut at 1500 characters"} if len(t) > TRANSLATE_CHARS else {})} for k, t in chunk]
        try:
            got, problem = (_batch_openai(client, model, context, payload) if provider == "openai"
                            else _batch_stackai(client, context, payload) if provider == "stackai"
                            else _batch_anthropic(client, context, payload))
        except ValueError:
            got, problem = None, "returned unreadable JSON"
        except Exception as e:
            name, msg = type(e).__name__, str(e)
            if name in ("AuthenticationError", "PermissionDeniedError") or "authentication method" in msg or (name == "HTTPError" and getattr(e, "code", 0) in (401, 403)):
                print(f"  translate: the {provider} credentials were rejected, so translation stops here.")
                return cache  # credentials won't fix themselves mid-run
            if name == "NotFoundError":
                print(f"  translate: model {model} is not available to this key. Pass --translate-model with one that is.")
                return cache
            print(f"  translate: request failed ({name}: {msg[:160]})")
            continue
        if problem or got is None:
            print(f"  translate: batch {problem or 'returned nothing'}; those posts stay untranslated")
            continue
        for it in got:
            if it.get("id") in keyed:
                cache[it["id"]] = {"language": it["language"], "english": bool(it["is_english"]), "translation": it["translation"].strip(), "by": by}
        cache_file.write_text(json.dumps(cache, ensure_ascii=False))
    return cache

def parse(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)

# ---------------- join ----------------
def run(cfg, do_translate=False, provider="openai", model=None):
    import pandas as pd
    out = ROOT / "data" / "social" / cfg["slug"]
    out.mkdir(parents=True, exist_ok=True)
    tz = ZoneInfo(cfg.get("timezone", "UTC"))
    print("gazetteer"); index = gazetteer(cfg["country"], cfg.get("bbox"))
    print("news (GDELT)"); news, query = gdelt(cfg)
    print("reddit (Arctic Shift)"); posts = reddit(cfg, index)
    tr = translate([it["text"] for it in news + posts], cfg.get("note", cfg["slug"]), provider, model) if do_translate else {}
    rows = []
    for it in news + posts:
        places = geoparse(it["text"], index)
        inbox = sorted([p for p in places if p["inBox"]] or places, key=lambda p: -p["specific"])
        district = inbox[0]["district"] if inbox else None
        lead = inbox[0] if inbox and inbox[0]["specific"] > 0 else None  # a province mention is not a map point
        rows.append({"source": it["source"], "time_utc": it["time"].isoformat(), "lon": lead["lon"] if lead else None, "lat": lead["lat"] if lead else None, "image": it.get("image", ""), "hour_utc": it["time"].strftime("%Y-%m-%dT%H:00Z"),
                     "hour_local": it["time"].astimezone(tz).strftime("%Y-%m-%dT%H:00"), "outlet": it["outlet"], "url": it["url"],
                     "excerpt": re.sub(r"\s+", " ", it["title"] or it["text"])[:140],
                     "places": "; ".join(sorted({p["place"] for p in places})), "district": district or "unlocated",
                     "ambiguous": any(p["ambiguous"] for p in places), "tags": "; ".join(tag(it["text"])),
                     **translation_fields(tr.get(sha1(it["text"].encode()).hexdigest()[:16])),
                     "precision": ("district" if lead and lead["specific"] == 1 else "town" if lead and lead["specific"] == 2 else "place" if lead else "none")})
    items = pd.DataFrame(rows).sort_values("time_utc") if rows else pd.DataFrame(columns=["source", "hour_utc", "district", "tags"])
    items.to_csv(out / "items.csv", index=False, quoting=csv.QUOTE_MINIMAL)
    table = pd.DataFrame()
    if len(items):
        base = items.groupby(["district", "hour_utc", "hour_local", "source"]).size().unstack("source", fill_value=0)
        tagged = items.assign(tag=items["tags"].str.split("; ")).explode("tag")
        tagged = tagged[tagged["tag"].astype(bool) & tagged["tag"].notna()]
        bytag = tagged.groupby(["district", "hour_utc", "hour_local", "tag"]).size().unstack("tag", fill_value=0) if len(tagged) else None
        table = base if bytag is None else base.join(bytag, how="left").fillna(0).astype(int)
        table = table.rename(columns={"news": "news_count", "reddit": "reddit_count"}).reset_index()
        table.to_csv(out / "district_hour.csv", index=False)
    summary = {
        "area": cfg["slug"], "country": cfg["country"], "window_utc": [cfg["start"], cfg["end"]], "gdeltQuery": query,
        "counts": items.groupby("source").size().to_dict() if len(items) else {},
        "located": int((items["district"] != "unlocated").sum()) if len(items) else 0,
        "byDistrict": items[items["district"] != "unlocated"].groupby("district").size().sort_values(ascending=False).head(15).to_dict() if len(items) else {},
        "tagCounts": items["tags"].str.split("; ").explode().loc[lambda s: s.astype(bool)].value_counts().to_dict() if len(items) else {},
        "caveats": [line.strip(" -") for line in __doc__.split("Caveats, written into summary.json too:")[1].strip().split("\n  - ")],
    }
    feed = [{**{k: r[k] for k in ("source", "time_utc", "hour_local", "outlet", "url", "excerpt", "places", "district", "lon", "lat", "image", "tags", "lang", "translation", "translator")}, "precision": r["precision"]} for r in rows]  # unplaced items stay: they still describe the event
    (out / "feed.json").write_text(json.dumps(sorted(feed, key=lambda r: r["time_utc"]), ensure_ascii=False))
    summary["withImage"] = sum(1 for r in rows if r["image"])
    (out / "summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False))
    print(json.dumps({k: summary[k] for k in ("counts", "located", "byDistrict", "tagCounts")}, indent=1, ensure_ascii=False))

def translation_fields(t):
    """Language and a short English excerpt for the app. English posts carry no translation."""
    if not t:
        return {"lang": "", "translation": "", "translator": ""}
    out = t["translation"] if not t["english"] else ""
    return {"lang": t["language"], "translation": (out[:277] + "…") if len(out) > 280 else out, "translator": t.get("by", "") if out else ""}

def selftest():
    p = lambda i, name, code, pop, a2, inbox: {"id": i, "name": name, "code": code, "pop": pop, "adm1": "P", "adm2": a2, "inBox": inbox, "lon": 85.3, "lat": 28.1}
    index = {"timure": [p(1, "Timure", "PPLL", 0, "Rasuwa", True), p(2, "Timure", "PPLL", 0, "Dolakha", False)],
             "bhote koshi": [p(3, "Bhote Koshi", "STM", 0, "Rasuwa", True)], "koshi": [p(4, "Koshi", "ADM1", 0, "Sunsari", False)],
             "rasuwa": [p(5, "Rasuwa", "ADM2", 0, "Rasuwa", True)], "रसुवा": [p(5, "Rasuwa", "ADM2", 0, "Rasuwa", True)]}
    got = geoparse("Bridge at Timure gone, the Bhote Koshi is rising. रसुवा needs help", index)
    assert [g["place"] for g in got] == ["Timure", "Bhote Koshi", "Rasuwa"], got   # longest match, Devanagari too
    assert got[0]["district"] == "Rasuwa" and got[0]["ambiguous"]                    # the in-box Timure wins, flagged
    assert geoparse("we need to timure later", index) == []                          # lowercase ASCII never matches
    index["bhandari"] = [p(6, "Bhandari", "PPLL", 0, "Sindhuli", False)]
    assert geoparse("Ram Bhandari said", index) == []                                # small hamlet outside the box: ignored
    assert set(tag("Bridge washed away, 3 dead, please help send food")) >= {"infrastructure_and_utility_damage", "injured_or_dead_people", "requests_or_urgent_needs"}
    assert tag("Coffee export question") == []
    # translation: batching, English passthrough, refusal handling, and the cache, against a fake client (no API call)
    import tempfile, types
    global CACHE
    real_cache, CACHE = CACHE, Path(tempfile.mkdtemp())
    def answer(items):
        return [{"id": x["id"], "language": "English" if x["text"].startswith("The") else "Nepali (romanized)",
                 "is_english": x["text"].startswith("The"), "translation": "" if x["text"].startswith("The") else "EN: " + x["text"]} for x in items]
    calls = []
    class FakeOpenAI:  # chat.completions.create with a strict JSON schema
        def __init__(self): self.chat = types.SimpleNamespace(completions=types.SimpleNamespace(create=self.create))
        def create(self, **kw):
            calls.append(kw)
            assert kw["model"] == OPENAI_TRANSLATE_MODEL and kw["response_format"]["json_schema"]["strict"] is True and "max_completion_tokens" in kw
            items = json.loads(kw["messages"][1]["content"].split("Items (JSON):\n", 1)[1])
            if len(calls) == 2:  # second batch: the model declines
                msg = types.SimpleNamespace(content=None, refusal="I can't help with that.")
            else:
                msg = types.SimpleNamespace(content=json.dumps({"items": answer(items)}), refusal=None)
            return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg, finish_reason="stop")])
    texts = ["The bridge is down"] + [f"pani aayo {n}" for n in range(TRANSLATE_BATCH)]  # 26 texts: two batches, the second declined
    got = translate(texts, "test", "openai", client=FakeOpenAI())
    key = lambda t: sha1(t.encode()).hexdigest()[:16]
    assert len(calls) == 2 and got[key("The bridge is down")]["english"] is True
    assert got[key("pani aayo 0")]["translation"] == "EN: pani aayo 0" and key(texts[-1]) not in got  # declined batch left out
    assert translation_fields(got[key("pani aayo 0")]) == {"lang": "Nepali (romanized)", "translation": "EN: pani aayo 0", "translator": f"OpenAI {OPENAI_TRANSLATE_MODEL}"}
    assert translation_fields(got[key("The bridge is down")])["translation"] == ""  # English: no translation, original stays
    translate(texts[:5], "test", "openai", client=FakeOpenAI()); assert len(calls) == 2  # all cached: no new request
    class FakeClaude:
        def __init__(self): self.beta = types.SimpleNamespace(messages=types.SimpleNamespace(create=self.create))
        def create(self, **kw):
            assert kw["fallbacks"] == "default" and kw["output_config"]["effort"] == "low"
            items = json.loads(kw["messages"][0]["content"].split("Items (JSON):\n", 1)[1])
            return types.SimpleNamespace(stop_reason="end_turn", content=[types.SimpleNamespace(type="text", text=json.dumps({"items": answer(items)}))])
    got = translate([texts[-1]], "test", "anthropic", client=FakeClaude())
    assert got[key(texts[-1])]["by"].startswith("Claude")
    class FakeStackAI:  # replies like a chat model: prose plus a fenced JSON block, with one malformed item
        def __init__(self): self.prompts = []
        def run(self, text):
            self.prompts.append(text)
            items = json.loads(text.split("Items (JSON):\n", 1)[1])
            body = answer(items) + [{"id": "junk"}]
            return {"outputs": {"out-0": "Sure! Here you go:\n```json\n" + json.dumps({"items": body}) + "\n```"}}
    fs = FakeStackAI()
    got = translate(["mero ghar dubyo"], "test", "stackai", client=fs)
    assert got[key("mero ghar dubyo")] == {"language": "Nepali (romanized)", "english": False, "translation": "EN: mero ghar dubyo", "by": "a StackAI flow"}
    assert "junk" not in got and "Reply with JSON only" in fs.prompts[0] and "Items (JSON)" in fs.prompts[0]
    assert _flow_text({"outputs": {"out-1": "x"}}) == "x" and _json_in("no json here") is None
    class Bad:
        def run(self, text): return {"outputs": {"out-0": "I can only answer questions about our product."}}
    assert key("mero ghar baggyo") not in translate(["mero ghar baggyo"], "test", "stackai", client=Bad())
    assert env_key("NO_SUCH_KEY_FOR_TEST") is None
    CACHE = real_cache
    print("selftest ok")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--config")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--translate", action="store_true", help="detect language and translate non-English posts (keeps the original too)")
    ap.add_argument("--translate-provider", choices=["openai", "anthropic", "stackai"], default="openai")
    ap.add_argument("--translate-model", default=None, help=f"default: $OPENAI_TRANSLATE_MODEL or {OPENAI_TRANSLATE_MODEL} for OpenAI")
    a = ap.parse_args()
    if a.selftest:
        selftest()
    else:
        import os
        run(json.loads(Path(a.config).read_text()), do_translate=a.translate, provider=a.translate_provider,
            model=a.translate_model or (os.environ.get("OPENAI_TRANSLATE_MODEL") if a.translate_provider == "openai" else None))
