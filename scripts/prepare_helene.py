"""
Build the Helene (western NC) road network and snap NCDOT TIMS closure records onto it.

Inputs:
  --osm   north-carolina-240101.osm.pbf   Geofabrik snapshot, 2 Jan 2024 (PRE-storm; ODbL)  -- NOT the 'latest' file (post-event leak)
  --out   data/real/helene                (must already contain tims.json from scripts/fetch_tims.mjs)

Run:  python -I scripts/prepare_helene.py --osm ... --out data/real/helene
Outputs: network.json (compact edges), tims_match.json (record id -> edge, distance, how matched), provenance.json

Matching: normalise NCDOT road ("US-221", "SR-1002", "NC-16", "I-40") and OSM `ref`; among edges within MAX_SNAP_M prefer
those whose ref matches, nearest first; else nearest edge of any class (flagged 'nearest'); else 'unmatched'.
Assumptions: roads undirected; identical coordinates = same node; free-flow speed per class (for later routing).
"""
import argparse, json, math, re
from collections import defaultdict

import pyogrio.raw as raw
import shapely
from shapely import STRtree
from shapely.geometry import LineString, Point

BBOX = (-83.25, 35.30, -82.25, 35.95)  # Buncombe + Haywood + margin
MAX_SNAP_M = 250
SPEED = {"motorway": 100, "trunk": 80, "primary": 65, "secondary": 55, "tertiary": 45, "unclassified": 40, "residential": 30, "living_street": 15, "service": 20}
KEEP = set(SPEED) - {"service"} | {k + "_link" for k in ("motorway", "trunk", "primary", "secondary", "tertiary")}
LAT0 = 35.6
KX, KY = 111320.0 * math.cos(math.radians(LAT0)), 110900.0  # metres per degree at LAT0


def hs(s):
    return dict(re.findall(r'"([^"]+)"=>"((?:[^"\\]|\\.)*)"', s or ""))


def dist_m(a, b):
    return math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY)


def norm_ref(s):
    return re.sub(r"\s+", " ", (s or "").upper().replace("-", " ")).strip()


ap = argparse.ArgumentParser()
ap.add_argument("--osm", required=True)
ap.add_argument("--out", required=True)
args = ap.parse_args()

meta, _, geoms, data = raw.read(args.osm, layer="lines", bbox=BBOX, where="highway IS NOT NULL")
names = list(meta["fields"])
ways = []
for k in range(len(geoms)):
    r = {n: data[i][k] for i, n in enumerate(names)}
    g = shapely.from_wkb(geoms[k])
    if r["highway"] not in KEEP or g is None or g.geom_type != "LineString":
        continue
    tags = hs(r.get("other_tags"))
    refs = {norm_ref(x) for x in (tags.get("ref") or "").split(";") if x.strip()}
    ways.append(dict(id=int(r["osm_id"]), name=r.get("name") or tags.get("name"), cls=r["highway"], refs=sorted(refs),
                     bridge=tags.get("bridge", "no") not in ("no", ""), coords=[(round(x, 6), round(y, 6)) for x, y in g.coords]))
print("ways:", len(ways), "| with ref:", sum(bool(w["refs"]) for w in ways), "| bridges:", sum(w["bridge"] for w in ways))

use = defaultdict(int)
for w in ways:
    for c in set(w["coords"]):
        use[c] += 1
    use[w["coords"][0]] += 1
    use[w["coords"][-1]] += 1
node_ix, nodes = {}, []


def nid(c):
    if c not in node_ix:
        node_ix[c] = len(nodes)
        nodes.append(c)
    return node_ix[c]


edges = []
for w in ways:
    cs, start = w["coords"], 0
    for i in range(1, len(cs)):
        if i == len(cs) - 1 or use[cs[i]] >= 2:
            seg = cs[start : i + 1]
            L = sum(dist_m(seg[k], seg[k + 1]) for k in range(len(seg) - 1))
            u, v = nid(seg[0]), nid(seg[-1])
            if u != v and L > 0:
                cl = w["cls"].replace("_link", "")
                edges.append(dict(u=u, v=v, len=L, cls=cl, bridge=w["bridge"], name=w["name"], refs=w["refs"], way=w["id"], minutes=L / 1000 / SPEED[cl] * 60, coords=seg))
            start = i
print("network: nodes", len(nodes), "edges", len(edges))

# ---------- snap NCDOT TIMS records ----------
tims = json.load(open(f"{args.out}/tims.json"))
metric = lambda coords: LineString([((x) * KX, (y) * KY) for x, y in coords])
lines_m = [metric(e["coords"]) for e in edges]
tree = STRtree(lines_m)
matches, how_count = {}, defaultdict(int)
for rec in tims["records"]:
    if not (BBOX[0] <= rec["lon"] <= BBOX[2] and BBOX[1] <= rec["lat"] <= BBOX[3]):
        continue
    p = Point(rec["lon"] * KX, rec["lat"] * KY)
    cand = [int(i) for i in tree.query(p.buffer(MAX_SNAP_M))]
    cand = [(float(p.distance(lines_m[i])), i) for i in cand if p.distance(lines_m[i]) <= MAX_SNAP_M]
    cand.sort()
    want = norm_ref(rec["road"])
    ref_hits = [(d, i) for d, i in cand if want and want in edges[i]["refs"]]
    if ref_hits:
        d, i = ref_hits[0]; how = "ref"
    elif cand:
        d, i = cand[0]; how = "nearest"
    else:
        d, i, how = None, None, "unmatched"
    how_count[how] += 1
    matches[rec["id"]] = {"edge": i, "distM": None if d is None else round(d, 1), "how": how, "nearestAlso": [j for _, j in cand[:3]]}
print("snap results:", dict(how_count), "of", len(matches), "records inside bbox")

r5 = lambda c: [round(c[0], 5), round(c[1], 5)]
json.dump({
    "nodes": [r5(c) for c in nodes],
    "edges": [[e["u"], e["v"], round(e["minutes"], 2), round(e["len"], 0), e["cls"], int(e["bridge"]), e["name"], ";".join(e["refs"]) or None, e["way"],
               [r5(c) for c in e["coords"]] if len(e["coords"]) > 2 else None] for e in edges],
    "edgeFields": ["u", "v", "minutes", "lengthM", "class", "bridge", "name", "refs", "osmWayId", "viaCoords(null=straight)"],
}, open(f"{args.out}/network.json", "w"), separators=(",", ":"))
json.dump(matches, open(f"{args.out}/tims_match.json", "w"), separators=(",", ":"))
json.dump({
    "area": "Western NC slice: Buncombe + Haywood + margin", "bbox": BBOX,
    "network": {"source": "OpenStreetMap via Geofabrik north-carolina-240101.osm.pbf", "snapshot": "2024-01-02", "phase": "pre-event", "licence": "ODbL (c) OpenStreetMap contributors",
                "speedKmhByClass": SPEED, "assumptions": ["roads undirected", "free-flow speeds are assumptions", "exact coordinate match = same node", "service roads/tracks/paths excluded"]},
    "closures": {"source": tims["source"], "retrievedAt": tims["retrievedAt"], "window": tims["window"], "disclaimer": tims["disclaimer"]},
    "snap": {"maxSnapM": MAX_SNAP_M, "results": dict(how_count)},
    "counts": {"nodes": len(nodes), "edges": len(edges)},
}, open(f"{args.out}/provenance.json", "w"), indent=1)
print("done")
