"""
Fetch NASA Black Marble nightly lights (VNP46A2 v2, daily, ~460 m) for the Kathmandu valley and find areas that went
dark after the Sept 2024 flood. Output: data/real/kathmandu/night_lights.json

Needs EARTHDATA_TOKEN (an Earthdata Login token, urs.earthdata.nasa.gov → Generate Token) in the environment.
    set -a; . ./.env; set +a
    python -I scripts/fetch_blackmarble.py --cache /path/to/cache

Method (simple and stated, not tuned):
  - Only high-quality, cloud-free pixels are used (Mandatory_Quality_Flag 0 or 1). Gap-filled values are NOT used.
  - Baseline per cell = median of its clear nights, 19 Aug to 25 Sep 2024 (before the rain).
  - A cell counts as lit if its baseline is at least LIT_MIN nW/cm²/sr with at least 3 clear baseline nights.
  - Flood value per cell = median of its clear nights, 29 Sep to 2 Oct. 28 Sep was fully clouded over the valley and
    the archive has no files for 26 and 27 Sep, so the darkest hours themselves are not observed.
  - Dark = flood value below DARK_RATIO of baseline. Dim = below DIM_RATIO.
  - False-alarm check: the same rule applied to an ordinary window (7 to 10 Oct) against the same baseline.

Caveats: thin cloud or smoke that passes the quality flags also dims lights, and cells seen on only one flood night
are noisy. Treat a dark cell as "likely lost power", not as a confirmed outage.

Source: NASA Black Marble VNP46A2 v2, LAADS DAAC (doi:10.5067/VIIRS/VNP46A2.002). NASA data are free to use; cite it.
"""
import argparse, datetime as D, json, os, sys, urllib.request
import h5py
import numpy as np

BBOX = (85.284, 27.587, 85.493, 27.788)  # = UNOSAT SPOT-6 analysis extent
FETCH = (D.date(2024, 8, 19), D.date(2024, 10, 10))
BASE = (D.date(2024, 8, 19), D.date(2024, 9, 25))
FLOOD = (D.date(2024, 9, 29), D.date(2024, 10, 2))
CONTROL = (D.date(2024, 10, 7), D.date(2024, 10, 10))
LIT_MIN, DARK_RATIO, DIM_RATIO = 5.0, 0.5, 0.75
OUT = "data/real/kathmandu/night_lights.json"
FIELDS = "HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields"

ap = argparse.ArgumentParser()
ap.add_argument("--cache", default=os.path.expanduser("~/.cache/cascadeiq/blackmarble"))
args = ap.parse_args()
os.makedirs(args.cache, exist_ok=True)
token = os.environ.get("EARTHDATA_TOKEN")
if not token:
    sys.exit("Set EARTHDATA_TOKEN (see .env.example).")

# 1. Find granules in NASA's catalogue (CMR) and download any not cached, from the Earthdata Cloud mirror (accepts tokens).
q = (f"https://cmr.earthdata.nasa.gov/search/granules.json?short_name=VNP46A2&version=2&page_size=200"
     f"&temporal={FETCH[0]}T00:00:00Z,{FETCH[1]}T23:59:59Z&bounding_box={BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}")
entries = json.load(urllib.request.urlopen(q, timeout=120))["feed"]["entry"]
urls = [l["href"] for g in entries for l in g["links"] if l["href"].startswith("https://data.laadsdaac") and l["href"].endswith(".h5")]
print(f"{len(urls)} granules listed")
for u in urls:
    path = os.path.join(args.cache, u.rsplit("/", 1)[1].split(".")[1] + ".h5")  # A2024272.h5
    if os.path.exists(path) and open(path, "rb").read(4) == b"\x89HDF":
        continue
    print("  downloading", os.path.basename(path))
    req = urllib.request.Request(u, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=600) as r, open(path, "wb") as f:
        f.write(r.read())

# 2. Read the valley window from each night.
nights, lat_v, lon_v = {}, None, None
for name in sorted(os.listdir(args.cache)):
    if not name.startswith("A2024") or not name.endswith(".h5"):
        continue
    day = D.date(2024, 1, 1) + D.timedelta(int(name[5:8]) - 1)
    if not (FETCH[0] <= day <= FETCH[1]):
        continue
    g = h5py.File(os.path.join(args.cache, name))[FIELDS]
    lat, lon = g["lat"][:], g["lon"][:]
    yi = np.where((lat >= BBOX[1]) & (lat <= BBOX[3]))[0]
    xi = np.where((lon >= BBOX[0]) & (lon <= BBOX[2]))[0]
    sl = (slice(yi.min(), yi.max() + 1), slice(xi.min(), xi.max() + 1))
    ntl = g["DNB_BRDF-Corrected_NTL"][sl].astype(float)
    qf = g["Mandatory_Quality_Flag"][sl]
    ntl[~((qf <= 1) & np.isfinite(ntl) & (ntl < 6000))] = np.nan
    nights[day] = ntl
    lat_v, lon_v = lat[yi], lon[xi]
days = sorted(nights)
print(f"{len(days)} nights read, grid {nights[days[0]].shape}")

def window(a, b):
    return np.stack([nights[d] for d in days if a <= d <= b])

def med(stack):
    out = np.full(stack.shape[1:], np.nan)
    has = np.isfinite(stack).any(0)
    out[has] = np.nanmedian(stack[:, has], 0)
    return out

base_s = window(*BASE)
base, nbase = med(base_s), np.isfinite(base_s).sum(0)
lit = (base >= LIT_MIN) & (nbase >= 3)
flood_s = window(*FLOOD)
flood, nflood = med(flood_s), np.isfinite(flood_s).sum(0)
control = med(window(*CONTROL))

def classify(v):
    seen = lit & np.isfinite(v)
    r = np.where(seen, v / np.where(base > 0, base, np.nan), np.nan)
    return seen, r

seen, ratio = classify(flood)
cseen, cratio = classify(control)
dark = seen & (ratio < DARK_RATIO)
false_rate = float((cseen & (cratio < DARK_RATIO)).sum() / max(1, cseen.sum()))

# Per-night coverage, for the record.
coverage = []
for d in days:
    n = nights[d]
    s = lit & np.isfinite(n)
    coverage.append({"date": d.isoformat(), "clearShare": round(float(np.isfinite(n).mean()), 3),
                     "litSeen": int(s.sum()), "medianRatio": round(float(np.median(n[s] / base[s])), 2) if s.any() else None})

# 3. Cells (only lit ones; centre point + half-size so the console can draw squares).
dy, dx = abs(float(lat_v[1] - lat_v[0])), abs(float(lon_v[1] - lon_v[0]))
cells = []
for i, j in zip(*np.where(lit)):
    st = "unseen" if not seen[i, j] else "dark" if ratio[i, j] < DARK_RATIO else "dim" if ratio[i, j] < DIM_RATIO else "normal"
    cells.append({"r": int(i), "c": int(j), "lon": round(float(lon_v[j]), 5), "lat": round(float(lat_v[i]), 5),
                  "base": round(float(base[i, j]), 1), "flood": None if not seen[i, j] else round(float(flood[i, j]), 1),
                  "ratio": None if not seen[i, j] else round(float(ratio[i, j]), 2), "nights": int(nflood[i, j]), "status": st})

# 4. Dark areas = 8-connected clusters of dark cells.
lab = -np.ones(dark.shape, int)
clusters = []
for i, j in zip(*np.where(dark)):
    if lab[i, j] >= 0:
        continue
    k, stack_, members = len(clusters), [(i, j)], []
    lab[i, j] = k
    while stack_:
        a, b = stack_.pop()
        members.append((a, b))
        for da in (-1, 0, 1):
            for db in (-1, 0, 1):
                y, x = a + da, b + db
                if 0 <= y < dark.shape[0] and 0 <= x < dark.shape[1] and dark[y, x] and lab[y, x] < 0:
                    lab[y, x] = k
                    stack_.append((y, x))
    clusters.append(members)
# Name each area after the nearest real OSM place with a Latin-script name (places.json, pre-event OSM).
places = [p for p in json.load(open("data/real/kathmandu/places.json"))["places"] if p["name"] and p["name"].isascii()]

def near_place(lon, lat):
    p = min(places, key=lambda p: ((p["lon"] - lon) * 98.6) ** 2 + ((p["lat"] - lat) * 110.6) ** 2)
    return p["name"]

def hull(points):
    """Convex hull (monotone chain) of (lon, lat) points, closed ring."""
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts + pts[:1]
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0: hi.pop()
        hi.append(p)
    ring = lo[:-1] + hi[:-1]
    return ring + ring[:1]

areas = []
for k, m in enumerate(sorted(clusters, key=len, reverse=True)):
    rs = [ratio[a, b] for a, b in m]
    clon, clat = float(np.mean([lon_v[b] for _, b in m])), float(np.mean([lat_v[a] for a, _ in m]))
    corners = [(round(float(lon_v[b]) + sx * dx / 2, 5), round(float(lat_v[a]) + sy * dy / 2, 5)) for a, b in m for sx in (-1, 1) for sy in (-1, 1)]
    areas.append({"id": f"NL-{k + 1:02d}", "name": f"Dark area near {near_place(clon, clat)}", "cells": len(m),
                  "areaKm2": round(len(m) * dx * 98.6 * dy * 110.6, 2), "lon": round(clon, 5), "lat": round(clat, 5),
                  "medianRatio": round(float(np.median(rs)), 2), "members": [[int(a), int(b)] for a, b in m],
                  "ring": [list(p) for p in hull(corners)]})

doc = {
    "source": "NASA Black Marble VNP46A2 v2 (daily, BRDF- and moonlight-corrected), LAADS DAAC, doi:10.5067/VIIRS/VNP46A2.002",
    "licence": "NASA data, free to use with citation",
    "retrievedAt": D.datetime.now(D.timezone.utc).isoformat(timespec="seconds"),
    "bbox": BBOX, "cellDeg": [dx, dy],
    "origin": [round(float(lon_v[0]), 6), round(float(lat_v[0]), 6)],  # centre of cell r=0, c=0; lat falls as r grows
    "windows": {"baseline": [str(BASE[0]), str(BASE[1])], "flood": [str(FLOOD[0]), str(FLOOD[1])], "control": [str(CONTROL[0]), str(CONTROL[1])]},
    "rule": f"lit: baseline >= {LIT_MIN} nW/cm2/sr on >= 3 clear nights; dark: flood/baseline < {DARK_RATIO}; dim: < {DIM_RATIO}",
    "note": "28 Sep fully clouded and 26-27 Sep missing, so the worst hours are not observed. Thin cloud or smoke can also dim lights. A dark cell means likely lost power, not a confirmed outage.",
    "counts": {"lit": int(lit.sum()), "seenAfterFlood": int(seen.sum()), "dark": int(dark.sum()),
               "dim": int((seen & (ratio >= DARK_RATIO) & (ratio < DIM_RATIO)).sum()), "areas": len(areas),
               "controlFalseDarkRate": round(false_rate, 3)},
    "coverage": coverage, "cells": cells, "areas": areas,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(doc, open(OUT, "w"), separators=(",", ":"))
c = doc["counts"]
print(f"lit {c['lit']}, seen after flood {c['seenAfterFlood']}, dark {c['dark']}, dim {c['dim']}, dark areas {c['areas']}; "
      f"false-dark rate on ordinary nights {c['controlFalseDarkRate']:.1%}")
print("Wrote", OUT)
