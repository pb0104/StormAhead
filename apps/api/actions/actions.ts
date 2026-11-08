/**
 * Analyst action updates. The analyst types what they did ("Sent QRT-2 to Balkhu, 40 people moved to Kalimati open space");
 * the LLM (StackAI) turns it into structured actions, place names are matched against REAL gazetteer entries (never LLM
 * coordinates), the analyst confirms a one-line summary, and the action is saved to that location's history.
 *
 * An action never closes a location. It gives the recommender context: whether help is already there, whether people likely
 * remain (estimate, see need.ts), and which flagged areas have had no help at all.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inValley, load } from "../forecast/agents.ts";
import { complete, llmStatus, parseJsonLoose } from "../forecast/stackai.ts";
import { needNear, type NeedEstimate } from "./need.ts";

// ---------------------------------------------------------------- types
export type ActionKind = "dispatch" | "evacuate" | "supply" | "shelter" | "rescue" | "alert" | "road" | "other";
export type Resolved = { name: string; lon: number; lat: number; kind: string };
export type ActionDraft = {
  kind: ActionKind; resource: string | null; people: number | null; summary: string;
  placeText: string | null; destText: string | null; place: Resolved | null; dest: Resolved | null;
};
/** runId: the forecast run the action belongs to. A new run starts a fresh log; older runs stay on file for audit. */
export type ActionItem = ActionDraft & { id: string; loggedAt: string; text: string; by: "stackai" | "rules"; runId?: string; editedAt?: string };
export type Proposal = { text: string; actions: ActionDraft[]; line: string; warnings: string[]; by: "stackai" | "rules"; llmError?: string };
export type Coverage = { status: "none" | "partial" | "covered"; resources: string[]; evacuated: number; actions: number; need: NeedEstimate; remaining: number | null; last: string | null };
export type Target = { id: string; title: string; place: string; lon: number; lat: number; priority: string; agents: number; severity: string };
export type LastRun = { runId?: string; at: string; question: string; window: string; targets: Target[] };
export type NextRec = { kind: "more" | "next" | "idle"; text: string; target: { name: string; lon: number; lat: number } | null; prefill: string | null; basis: string | null };

// ---------------------------------------------------------------- storage (data/runtime, gitignored)
// STORMAHEAD_RUNTIME_DIR lets a test copy keep its log apart from the real one.
const RUNTIME = process.env.STORMAHEAD_RUNTIME_DIR ? `${process.env.STORMAHEAD_RUNTIME_DIR.replace(/\/$/, "")}/` : fileURLToPath(new URL("../../../data/runtime/", import.meta.url));
const ACTIONS_FILE = `${RUNTIME}actions.json`, RUN_FILE = `${RUNTIME}last_run.json`;
function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return fallback; }
}
function writeJson(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 1));
  renameSync(tmp, file); // atomic replace, so a crash never leaves half a log
}
let items: ActionItem[] | null = null;
/** Every action ever logged (all runs). */
const store = () => (items ??= readJson<{ items: ActionItem[] }>(ACTIONS_FILE, { items: [] }).items);
const persist = () => writeJson(ACTIONS_FILE, { items: store() });
let lastRun: LastRun | null | undefined;
export const getLastRun = () => (lastRun === undefined ? (lastRun = readJson<LastRun | null>(RUN_FILE, null)) : lastRun);
export function setLastRun(r: LastRun) { lastRun = { ...r, runId: r.runId ?? getLastRun()?.runId }; writeJson(RUN_FILE, lastRun); }
/** Actions logged before any forecast run share this bucket until the first run starts. */
const currentRunId = () => getLastRun()?.runId ?? "pre-run";
/** A new forecast run starts a clean action log: earlier runs' actions are kept on file but no longer shown or counted. */
export function startRun(runId: string, question: string, window: string) {
  lastRun = { runId, at: new Date().toISOString(), question, window, targets: [] };
  writeJson(RUN_FILE, lastRun);
}
/** Actions in the current run: the only ones the map, coverage, recommendations and report see. */
const all = () => store().filter((a) => (a.runId ?? "legacy") === currentRunId());
export const listActions = () => [...all()].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
export function saveActions(text: string, drafts: ActionDraft[], by: "stackai" | "rules"): ActionItem[] {
  const now = new Date().toISOString(), runId = currentRunId();
  const saved = drafts.map((d) => ({ ...d, id: randomUUID(), loggedAt: now, text, by, runId }));
  store().push(...saved);
  persist();
  return saved;
}
export function deleteAction(id: string): boolean {
  const i = store().findIndex((a) => a.id === id && (a.runId ?? "legacy") === currentRunId());
  if (i < 0) return false;
  store().splice(i, 1);
  persist();
  return true;
}
export type ActionEdit = Partial<{ kind: ActionKind; resource: string | null; people: number | null; placeText: string | null; destText: string | null; summary: string }>;
/** Edit an action in the current run. Place names are re-matched against the gazetteer; an unknown name is refused. */
export function updateAction(id: string, edit: ActionEdit): { ok: true; item: ActionItem } | { ok: false; error: string } {
  const a = store().find((x) => x.id === id && (x.runId ?? "legacy") === currentRunId());
  if (!a) return { ok: false, error: "No such action in this run" };
  const next: ActionItem = { ...a };
  if (edit.kind !== undefined) next.kind = edit.kind;
  if (edit.resource !== undefined) next.resource = edit.resource?.trim() || null;
  if (edit.people !== undefined) next.people = edit.people;
  if (edit.placeText !== undefined) {
    const t = edit.placeText?.trim() || null, r = resolvePlace(t);
    if (t && !r) return { ok: false, error: `Couldn't find “${t}” on the map` };
    next.placeText = t; next.place = r;
  }
  if (edit.destText !== undefined) {
    const t = edit.destText?.trim() || null, r = resolvePlace(t);
    if (t && !r) return { ok: false, error: `Couldn't find “${t}” on the map` };
    next.destText = t; next.dest = r;
  }
  // Keep the summary in step with the facts unless the caller wrote one.
  next.summary = edit.summary?.trim() || lineOf(next);
  next.editedAt = new Date().toISOString();
  Object.assign(a, next);
  persist();
  return { ok: true, item: a };
}

// ---------------------------------------------------------------- gazetteer (real names only)
type Entry = Resolved & { norm: string; tokens: string[]; rank: number };
const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const CATEGORY: [RegExp, string][] = [[/\b(open space|ground|park|field|tundikhel|maidan)\b/, "open space"], [/\bschool|college\b/, "school"], [/\bhospital|clinic\b/, "hospital"], [/\bward\b/, "ward"], [/\bcare home|elderly|old age\b/, "care home"]];
const STOP = new Set(["the", "near", "area", "open", "space", "ground", "at", "of", "school", "hospital", "ward", "park", "field", "side", "tole", "chowk"]);
let gaz: Entry[] | null = null;
function gazetteer(): Entry[] {
  if (gaz) return gaz;
  const out: Entry[] = [];
  const add = (name: string | null | undefined, lon: number, lat: number, kind: string, rank: number) => {
    if (!name || !/[A-Za-z]/.test(name) || !Number.isFinite(lon) || !inValley(lon, lat)) return;
    const n = norm(name); if (!n) return;
    out.push({ name, lon, lat, kind, norm: n, tokens: n.split(" "), rank });
  };
  type P = { name: string; at: [number, number] };
  const ops = load<{ openSpaces: P[]; hospitals: P[]; schools: P[] }>("real/kathmandu/ops_layers.json");
  for (const p of load<{ places: { name: string; lon: number; lat: number }[] }>("real/kathmandu/places.json").places) add(p.name, p.lon, p.lat, "place", 6);
  for (const w of load<{ wards: { name: string; lon: number; lat: number }[] }>("real/kathmandu/wards_bipad.json").wards) add(w.name, w.lon, w.lat, "ward", 3);
  for (const o of ops.openSpaces) add(o.name, o.at[0], o.at[1], "open space", 4);
  for (const h of ops.hospitals) add(h.name, h.at[0], h.at[1], "hospital", 2);
  for (const s of ops.schools) add(s.name, s.at[0], s.at[1], "school", 2);
  for (const c of load<{ careHomes: P[] }>("real/kathmandu/google_places.json").careHomes) add(c.name, c.at[0], c.at[1], "care home", 2);
  for (const b of load<{ buildings: { name: string | null; lon: number; lat: number }[] }>("real/kathmandu/buildings.json").buildings) add(b.name, b.lon, b.lat, "building", 0);
  return (gaz = out);
}
/** Match a place as written to a real gazetteer entry. Null when nothing is a confident match. */
export function resolvePlace(text: string | null): Resolved | null {
  if (!text) return null;
  const q = norm(text); if (!q) return null;
  const want = CATEGORY.find(([re]) => re.test(q))?.[1];
  const qt = q.split(" ").filter((t) => !STOP.has(t) && t.length > 1);
  if (!qt.length) return null;
  let best: Entry | null = null, bestScore = 0;
  for (const e of gazetteer()) {
    let s = 0;
    if (e.norm === q) s = 100;
    else if (qt.every((t) => e.tokens.includes(t))) s = 80 - Math.min(20, (e.tokens.length - qt.length) * 2);
    else if (qt.every((t) => e.tokens.some((et) => et.startsWith(t) && t.length >= 4))) s = 55;
    if (!s) continue;
    s += e.rank + (want && e.kind === want ? 15 : 0);
    if (s > bestScore) { best = e; bestScore = s; }
  }
  return best && bestScore >= 55 ? { name: best.name, lon: best.lon, lat: best.lat, kind: best.kind } : null;
}

/** Edit distance, capped (for misheard or misspelled names such as "Tigany" → "Tigani"). */
function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}
/** Find a place for navigation: the confident match (same rules as action updates) plus close suggestions. */
export function searchPlaces(raw: string, limit = 6): { match: Resolved | null; suggestions: Resolved[] } {
  // Tolerate the whole spoken command ("fly me to Tigani", "take me to the Khoria area").
  const text = raw.replace(/^\s*(please\s+)?(fly|take|go|zoom|navigate|show|bring|move)(\s+(me|us))?(\s+(over|in))?(\s+(to|into|on|at))?\s+/i, "").replace(/\s+(please|area|region)\s*$/i, "").trim() || raw;
  const match = resolvePlace(text);
  const q = norm(text), qt = q.split(" ").filter((t) => !STOP.has(t) && t.length > 1);
  if (!qt.length) return { match, suggestions: [] };
  const scored: { e: Entry; s: number }[] = [];
  for (const e of gazetteer()) {
    if (e.kind === "building" && !match) continue; // buildings only as exact hits, or suggestions get noisy
    let s = 0;
    for (const t of qt) {
      const best = Math.min(9, ...e.tokens.filter((et) => et.length >= 3).map((et) => (et === t ? 0 : (et.startsWith(t) && t.length >= 3) || (t.startsWith(et) && et.length >= 4) ? 1 : t.length >= 4 ? editDistance(t, et) : 9)));
      s += best;
    }
    if (s <= qt.length * 2) scored.push({ e, s: s - e.rank * 0.1 });
  }
  const seen = new Set<string>();
  const suggestions = scored.sort((a, b) => a.s - b.s || a.e.name.length - b.e.name.length)
    .filter(({ e }) => !seen.has(e.norm) && seen.add(e.norm))
    .slice(0, limit).map(({ e }) => ({ name: e.name, lon: e.lon, lat: e.lat, kind: e.kind }));
  return { match, suggestions };
}

// ---------------------------------------------------------------- parsing
const KINDS: ActionKind[] = ["dispatch", "evacuate", "supply", "shelter", "rescue", "alert", "road", "other"];
function parsePrompt(text: string) {
  return `You turn an emergency analyst's field update into structured actions for an operations log in the Kathmandu valley, Nepal.
UPDATE: "${text}"

Reply with JSON only:
{"actions":[{"kind":"dispatch|evacuate|supply|shelter|rescue|alert|road|other","resource":"team, vehicle or supply exactly as written (e.g. QRT-2, 2 boats, 300 food packs) or null","people":number or null,"place":"where the help went, or where people were moved FROM, exactly as written","destination":"where people or goods were moved TO, exactly as written, or null","summary":"under 9 words, past tense"}]}

Rules: one action per distinct thing done. If a move does not say where people came from, use the place of the previous action. Copy place names exactly as written; never add coordinates or places that were not mentioned. Numbers only if stated.`;
}
const VERB: [RegExp, ActionKind][] = [
  [/\b(evacuat\w*|moved|relocat\w*|shifted|took .* to)\b/i, "evacuate"], [/\b(rescued|pulled out|airlift\w*)\b/i, "rescue"],
  [/\b(deliver\w*|distribut\w*|dropped|food|water|supplies|packs|tarp\w*|medicine)\b/i, "supply"], [/\bopened? (a )?shelter|sheltered|housed\b/i, "shelter"],
  [/\b(alert\w*|warn\w*|announc\w*|sms|siren)\b/i, "alert"], [/\b(cleared|closed|reopened|blocked) (the )?(road|bridge|route)\b/i, "road"],
  [/\b(sent|dispatch\w*|deploy\w*|assigned|mobili[sz]ed|on site|arrived)\b/i, "dispatch"],
];
const RESOURCE_RE = /\b((?:QRT|SAR|NDRF|APF|team|crew|unit|ambulance|boat|truck|helicopter|fire engine|police|army)[\s-]?[A-Z0-9]*(?:\s?\d+)?|\d+\s+(?:boats?|trucks?|teams?|ambulances?|food packs?|packs?|tents?|tarps?))\b/i;
const PEOPLE_RE = /\b(\d[\d,]*)\s+(?:people|persons|residents|families|households|patients|students|villagers)\b/i;
const PLACE_RE = /\b(to|at|in|near|from)\s+((?:the\s+)?[A-Za-z][\w'’-]*(?:\s+(?!and\b|with\b|by\b|for\b|after\b)[A-Za-z0-9][\w'’-]*){0,4})/gi;

/** Rule fallback when the LLM is unavailable: good enough for "Sent X to Y, N people moved to Z". */
export function ruleParse(text: string): Omit<ActionDraft, "place" | "dest" | "summary">[] {
  const clauses = text.split(/[;,.]|\band then\b|\band\b(?=\s+(?:\d|sent|moved|evacuat|deliver|open|rescu))/i).map((c) => c.trim()).filter(Boolean);
  const out: Omit<ActionDraft, "place" | "dest" | "summary">[] = [];
  for (const c of clauses) {
    const kind = VERB.find(([re]) => re.test(c))?.[1] ?? "other";
    const people = Number(c.match(PEOPLE_RE)?.[1]?.replace(/,/g, "") ?? NaN);
    let res = c.match(RESOURCE_RE)?.[1] ?? null;
    if (res && /^\d+\s+(people|persons)/i.test(res)) res = null;
    const places = [...c.matchAll(PLACE_RE)].map((m) => ({ prep: m[1]!.toLowerCase(), name: m[2]!.replace(/^the\s+/i, "").trim() }));
    const from = places.find((p) => p.prep === "from")?.name ?? null;
    const to = places.find((p) => p.prep === "to")?.name ?? null;
    const at = places.find((p) => ["at", "in", "near"].includes(p.prep))?.name ?? null;
    let placeText: string | null, destText: string | null = null;
    if (kind === "evacuate" || kind === "shelter") { placeText = from ?? at ?? out[out.length - 1]?.placeText ?? null; destText = to; }
    else placeText = to ?? at ?? from ?? out[out.length - 1]?.placeText ?? null;
    if (kind === "other" && !placeText && !res && !Number.isFinite(people)) continue;
    out.push({ kind, resource: res, people: Number.isFinite(people) ? people : null, placeText, destText });
  }
  return out;
}

function lineOf(d: Omit<ActionDraft, "summary">): string {
  const p = d.placeText ?? "an unnamed place", who = d.resource ?? "Team";
  const n = d.people !== null ? `${d.people.toLocaleString("en-US")} people` : "People";
  switch (d.kind) {
    case "dispatch": return `${who} sent to ${p}`;
    case "evacuate": return `${n} moved${d.placeText ? ` from ${d.placeText}` : ""}${d.destText ? ` to ${d.destText}` : ""}`;
    case "rescue": return `${n} rescued at ${p}${d.resource ? ` by ${d.resource}` : ""}`;
    case "supply": return `${d.resource ?? "Supplies"} delivered to ${p}`;
    case "shelter": return `Shelter opened${d.destText ? ` at ${d.destText}` : ` at ${p}`}${d.people !== null ? ` for ${n.toLowerCase()}` : ""}`;
    case "alert": return `Alert issued for ${p}`;
    case "road": return `Road action at ${p}`;
    default: return `${d.resource ? `${d.resource}: ` : ""}action at ${p}`;
  }
}

export async function parseUpdate(text: string): Promise<Proposal> {
  let raw: Omit<ActionDraft, "place" | "dest">[] | null = null, by: "stackai" | "rules" = "rules", llmError: string | undefined;
  if (llmStatus().configured) {
    try {
      const reply = await complete(parsePrompt(text));
      const j = reply ? parseJsonLoose<{ actions?: { kind?: string; resource?: string | null; people?: number | string | null; place?: string | null; destination?: string | null; summary?: string }[] }>(reply) : null;
      if (j?.actions?.length) {
        raw = j.actions.slice(0, 6).map((a) => {
          const people = a.people === null || a.people === undefined ? NaN : Number(String(a.people).replace(/,/g, ""));
          return {
            kind: (KINDS.includes(a.kind as ActionKind) ? a.kind : "other") as ActionKind,
            resource: a.resource ? String(a.resource).slice(0, 60) : null, people: Number.isFinite(people) && people >= 0 ? Math.round(people) : null,
            placeText: a.place ? String(a.place).slice(0, 80) : null, destText: a.destination ? String(a.destination).slice(0, 80) : null,
            summary: String(a.summary ?? "").slice(0, 80),
          };
        });
        by = "stackai";
      }
    } catch (e) { llmError = (e as Error).message; }
  }
  raw ??= ruleParse(text).map((d) => ({ ...d, summary: "" }));
  const warnings: string[] = [];
  const actions: ActionDraft[] = raw.map((d) => {
    const place = resolvePlace(d.placeText), dest = resolvePlace(d.destText);
    if (d.placeText && !place) warnings.push(`Couldn't find “${d.placeText}” on the map.`);
    if (d.destText && !dest) warnings.push(`Couldn't find “${d.destText}” on the map.`);
    const full = { ...d, place, dest };
    return { ...full, summary: d.summary || lineOf(full) };
  });
  if (!actions.length) warnings.push("I couldn't find an action in that. Try e.g. “Sent QRT-2 to Balkhu, 40 people moved to Kalimati open space”.");
  return { text, actions, line: actions.map(lineOf).join(" · "), warnings: [...new Set(warnings)], by, ...(llmError ? { llmError } : {}) };
}

// ---------------------------------------------------------------- coverage + recommendations
const km = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => Math.hypot((a.lon - b.lon) * 98.6, (a.lat - b.lat) * 110.6);
const MOVED: ActionKind[] = ["evacuate", "rescue"];

export function coverageAt(lon: number, lat: number, radiusKm = 1): Coverage {
  const near = all().filter((a) => a.place && km(a.place, { lon, lat }) <= radiusKm);
  const need = needNear(lon, lat);
  const evacuated = near.filter((a) => MOVED.includes(a.kind)).reduce((s, a) => s + (a.people ?? 0), 0);
  const resources = [...new Set(near.map((a) => a.resource).filter((r): r is string => !!r))];
  const remaining = need.people === null ? null : Math.max(0, need.people - evacuated);
  const status: Coverage["status"] = !near.length ? "none"
    : remaining !== null && need.people !== null && remaining >= Math.max(50, need.people * 0.25) ? "partial" : "covered";
  return { status, resources, evacuated, actions: near.length, need, remaining, last: near.map((a) => a.loggedAt).sort().at(-1) ?? null };
}

/** Places that have actions, with what's been done there (for the map labels and the history panel). */
export function locations() {
  type Loc = { key: string; name: string; lon: number; lat: number; resources: string[]; evacuated: number; received: number; last: string; ids: string[]; lines: { id: string; at: string; summary: string; role: "here" | "received" }[] };
  const locs: Loc[] = [];
  const at = (r: Resolved) => {
    let l = locs.find((x) => km(x, r) <= 0.3);
    if (!l) { l = { key: `${r.name}|${r.lon.toFixed(4)}`, name: r.name, lon: r.lon, lat: r.lat, resources: [], evacuated: 0, received: 0, last: "", ids: [], lines: [] }; locs.push(l); }
    return l;
  };
  for (const a of all()) {
    if (a.place) {
      const l = at(a.place);
      if (a.resource && !l.resources.includes(a.resource)) l.resources.push(a.resource);
      if (MOVED.includes(a.kind)) l.evacuated += a.people ?? 0;
      l.ids.push(a.id); l.lines.push({ id: a.id, at: a.loggedAt, summary: a.summary, role: "here" });
      if (a.loggedAt > l.last) l.last = a.loggedAt;
    }
    if (a.dest) {
      const d = at(a.dest);
      d.received += a.people ?? 0;
      d.ids.push(a.id); d.lines.push({ id: a.id, at: a.loggedAt, summary: a.summary, role: "received" });
      if (a.loggedAt > d.last) d.last = a.loggedAt;
    }
  }
  return locs.map((l) => ({ ...l, lines: l.lines.sort((x, y) => y.at.localeCompare(x.at)) })).sort((a, b) => b.last.localeCompare(a.last));
}

const fmt = (n: number) => n.toLocaleString("en-US");
const listOf = (a: string[]) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);

/** Where to look next. Never treats a place as closed: help on site + people likely remaining → suggest more there. */
export function nextRecommendation(justAt?: Resolved | null): NextRec {
  if (justAt) {
    const c = coverageAt(justAt.lon, justAt.lat);
    if (c.status === "partial" && c.remaining !== null) {
      const who = c.resources.length ? `${listOf(c.resources.slice(0, 3))} ${c.resources.length > 1 ? "are" : "is"} at ${justAt.name}` : `Help is at ${justAt.name}`;
      return { kind: "more", text: `${who}, but about ${fmt(c.remaining)} people may still need help there (estimate). Send another team?`, target: justAt, prefill: `Sent another team to ${justAt.name}`, basis: c.need.basis };
    }
  }
  const run = getLastRun();
  if (!run?.targets.length) {
    return { kind: "idle", text: justAt ? `Logged for ${justAt.name}. Run a forecast and I'll point to the flagged areas that have had no help yet.` : "Run a forecast and I'll point to the flagged areas that have had no help yet.", target: null, prefill: null, basis: null };
  }
  const assessed = run.targets.filter((t) => !justAt || km(t, justAt) > 1).map((t) => ({ t, c: coverageAt(t.lon, t.lat) }));
  const open = assessed.find((x) => x.c.status === "none");
  const lead = justAt ? `${justAt.name} looks covered for now. ` : "";
  if (open) {
    const n = open.c.need.people;
    return { kind: "next", text: `${lead}Nothing has been done yet at ${open.t.place} (${open.t.priority}, flagged by ${open.t.agents} agent${open.t.agents === 1 ? "" : "s"}${n ? `, about ${fmt(n)} people on flooded ground, estimate` : ""}). Look there next?`, target: { name: open.t.place, lon: open.t.lon, lat: open.t.lat }, prefill: null, basis: n ? open.c.need.basis : null };
  }
  const partial = assessed.find((x) => x.c.status === "partial");
  if (partial && partial.c.remaining !== null) {
    return { kind: "more", text: `${lead}Every flagged area has had some help. ${partial.t.place} still has about ${fmt(partial.c.remaining)} people who may need help (estimate). Send more there?`, target: { name: partial.t.place, lon: partial.t.lon, lat: partial.t.lat }, prefill: `Sent another team to ${partial.t.place}`, basis: partial.c.need.basis };
  }
  return { kind: "idle", text: `${lead}Every area flagged in the last forecast has had help logged. Keep logging updates as they come in.`, target: null, prefill: null, basis: null };
}

/** Compact text for the LLM report: what's been done, and per flagged area whether help is there. */
export function actionsForPrompt(targets: Target[]): string {
  const acts = listActions().slice(0, 25);
  if (!acts.length) return "None logged yet.";
  const lines = acts.map((a) => `- ${a.loggedAt.slice(11, 16)} UTC: ${a.summary}${a.place ? ` [at ${a.place.name}]` : ""}${a.dest ? ` [to ${a.dest.name}]` : ""}`);
  const cov = targets.map((t) => { const c = coverageAt(t.lon, t.lat); return `- ${t.priority} ${t.place}: ${c.status === "none" ? "NO ACTION YET" : `${c.status === "partial" ? "help on site, people likely remain" : "help on site, looks covered"} (${c.resources.join(", ") || "team"}${c.evacuated ? `, ${c.evacuated} moved` : ""}${c.remaining !== null ? `, ~${c.remaining} may remain (estimate)` : ""})`}`; });
  return `${lines.join("\n")}\n\nCoverage of flagged areas:\n${cov.join("\n")}`;
}
