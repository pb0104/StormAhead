"""
Build the Kathmandu-valley hindcast dataset (derived data committed under data/real/kathmandu/).

Inputs (download separately; see docs/real-data-findings.md):
  --osm   nepal-240101.osm.pbf   Geofabrik snapshot, 2 Jan 2024 (PRE-event; ODbL)
  --flood Spot6_20240930_FloodExtent_Kathmandu.shp   UNOSAT product 3996 (CC BY-SA): OBSERVED extent, used as the *given* hazard
  --out   data/real/kathmandu    (must already contain incidents.json from scripts/fetch_bipad.mjs; only distance-to-flood is added)

Run:  python -I scripts/prepare_kathmandu.py --osm ... --flood ... --out data/real/kathmandu

Spatial pre-computation done here (NOT in the TypeScript engine): per-edge flooded share, per-place / hospital
in-flood flag and distance to flood. The impact reasoning (closures, access, cascades, scoring) lives in TypeScript.
Assumptions (documented, not measured): free-flow speed per highway class; roads undirected; identical coordinates = same node.
"""
import argparse, json, math, re
from collections import defaultdict

import pyogrio.raw as raw
import shapely
from shapely import STRtree
from shapely.geometry import LineString, Point, mapping
from shapely.ops import unary_union
from shapely.prepared import prep

BBOX = (85.284, 27.587, 85.493, 27.788)  # UNOSAT SPOT-6 analysis extent: "not flooded" is only asserted inside it
SPEED = {"motorway": 60, "trunk": 40, "primary": 35, "secondary": 30, "tertiary": 25, "unclassified": 20, "residential": 15, "living_street": 10}
KEEP = set(SPEED) | {k + "_link" for k in ("motorway", "trunk", "primary", "secondary", "tertiary")}
KX, KY = 98600.0, 110600.0  # metres per degree at ~27.7N (local equirectangular; adequate over ~20 km)
PLACE_TYPES = {"neighbourhood", "suburb", "quarter", "village", "hamlet", "town", "city", "locality"}


def hs(s):
    """Parse GDAL 'other_tags' hstore text."""
    return dict(re.findall(r'"([^"]+)"=>"((?:[^"\\]|\\.)*)"', s or ""))


def dist_m(a, b):
    return math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY)


def read_layer(path, layer, where=None):
    meta, _, geoms, data = raw.read(path, layer=layer, bbox=BBOX, where=where)
    names = list(meta["fields"])
    rows = [{n: data[i][k] for i, n in enumerate(names)} for k in range(len(geoms))]
    return rows, shapely.from_wkb(geoms)


def to_m(g):  # lon/lat -> local metres
    return shapely.transform(g, lambda c: c * [KX, KY])


ap = argparse.ArgumentParser()
ap.add_argument("--osm", required=True)
ap.add_argument("--flood", required=True)
ap.add_argument("--out", required=True)
args = ap.parse_args()

# ---------------- observed flood extent (the GIVEN hazard) ----------------
_, _, fg, _ = raw.read(args.flood)
flood = unary_union(shapely.from_wkb(fg))
flood_m = to_m(flood)
flood_prep = prep(flood)
print("flood polygons:", len(getattr(flood, "geoms", [flood])))

# ---------------- road network (PRE-event OSM) ----------------
rows, geoms = read_layer(args.osm, "lines", where="highway IS NOT NULL")
ways = []
for r, g in zip(rows, geoms):
    if r["highway"] not in KEEP or g is None or g.geom_type != "LineString":
        continue
    tags = hs(r.get("other_tags"))
    ways.append(dict(id=int(r["osm_id"]), name=r.get("name") or tags.get("name"), cls=r["highway"],
                     bridge=tags.get("bridge", "no") not in ("no", ""), coords=[(round(x, 6), round(y, 6)) for x, y in g.coords]))
print("highway ways kept:", len(ways), "| bridges:", sum(w["bridge"] for w in ways))

# nodes at way endpoints and at any coordinate used by >=2 ways (or twice in one way)
use = defaultdict(int)
for w in ways:
    for c in set(w["coords"]):
        use[c] += 1
    use[w["coords"][0]] += 1
    use[w["coords"][-1]] += 1
is_node = lambda c: use[c] >= 2
node_ix, nodes = {}, []


def nid(c):
    if c not in node_ix:
        node_ix[c] = len(nodes)
        nodes.append(c)
    return node_ix[c]


edges = []
for w in ways:
    cs = w["coords"]
    start = 0
    for i in range(1, len(cs)):
        if i == len(cs) - 1 or is_node(cs[i]):
            seg = cs[start : i + 1]
            L = sum(dist_m(seg[k], seg[k + 1]) for k in range(len(seg) - 1))
            u, v = nid(seg[0]), nid(seg[-1])
            if u != v and L > 0:
                edges.append(dict(u=u, v=v, len=L, cls=w["cls"].replace("_link", ""), bridge=w["bridge"], name=w["name"], way=w["id"],
                                  minutes=L / 1000 / SPEED[w["cls"].replace("_link", "")] * 60, coords=seg))
            start = i
print("network: nodes", len(nodes), "edges", len(edges))

# per-edge exposure to the observed flood extent
lines = [LineString(e["coords"]) for e in edges]
for e, ln in zip(edges, lines):
    if flood_prep.intersects(ln):
        inter = ln.intersection(flood)
        e["share"] = min(1.0, (inter.length / ln.length) if ln.length else 0.0)
    else:
        e["share"] = 0.0
mid = [ln.interpolate(0.5, normalized=True) for ln in lines]
for e, m in zip(edges, mid):
    e["mid"] = (round(m.x, 6), round(m.y, 6))
    e["distFloodM"] = round(float(shapely.distance(to_m(m), flood_m)), 0) if e["share"] == 0 else 0
print("edges touching flood:", sum(e["share"] > 0 for e in edges), "| bridges touching:", sum(e["share"] > 0 and e["bridge"] for e in edges))

# ---------------- places and hospitals ----------------
node_pts = shapely.points([(c[0], c[1]) for c in nodes])
tree = STRtree(node_pts)


def snap(p, maxm):
    i = int(tree.nearest(Point(p)))
    return (i, dist_m(p, nodes[i])) if dist_m(p, nodes[i]) <= maxm else (None, None)


prow, pg = read_layer(args.osm, "points", where="place IS NOT NULL")
places = []
for r, g in zip(prow, pg):
    if r["place"] not in PLACE_TYPES or not r.get("name"):
        continue
    p = (round(g.x, 6), round(g.y, 6))
    i, d = snap(p, 400)
    if i is None:
        continue
    places.append(dict(id=int(r["osm_id"]), name=r["name"], type=r["place"], lon=p[0], lat=p[1], node=i, inFlood=bool(flood_prep.contains(Point(p))),
                       distFloodM=0 if flood_prep.contains(Point(p)) else round(float(shapely.distance(to_m(Point(p)), flood_m)), 0)))

hosp = []
mrow, mg = read_layer(args.osm, "multipolygons", where="amenity = 'hospital'")
for r, g in zip(mrow, mg):
    c = g.centroid; hosp.append((r.get("name") or "Hospital (unnamed)", (round(c.x, 6), round(c.y, 6)), int(r.get("osm_id") or r.get("osm_way_id") or 0)))
prow2, pg2 = read_layer(args.osm, "points", where="other_tags LIKE '%\"amenity\"=>\"hospital\"%'")
for r, g in zip(prow2, pg2):
    hosp.append((r.get("name") or "Hospital (unnamed)", (round(g.x, 6), round(g.y, 6)), int(r["osm_id"])))
hospitals = []
for name, p, oid in hosp:  # de-dup within 150 m
    if any(dist_m(p, (h["lon"], h["lat"])) < 150 for h in hospitals):
        continue
    i, d = snap(p, 600)
    if i is None:
        continue
    inside = bool(flood_prep.contains(Point(p)))
    hospitals.append(dict(id=oid, name=name, lon=p[0], lat=p[1], node=i, inFlood=inside,
                          distFloodM=0 if inside else round(float(shapely.distance(to_m(Point(p)), flood_m)), 0)))
print("places:", len(places), "(in flood:", sum(p["inFlood"] for p in places), ") | hospitals:", len(hospitals), "(in flood:", sum(h["inFlood"] for h in hospitals), ")")

# ---------------- incidents: add distance to flood (evaluation metadata only) ----------------
ip = f"{args.out}/incidents.json"
inc = json.load(open(ip))
for i in inc["incidents"]:
    pt = Point(i["lon"], i["lat"])
    i["distFloodM"] = 0 if flood_prep.contains(pt) else round(float(shapely.distance(to_m(pt), flood_m)), 0)
json.dump(inc, open(ip, "w"), indent=1)

# ---------------- write ----------------
r5 = lambda c: [round(c[0], 5), round(c[1], 5)]
json.dump({
    "nodes": [r5(c) for c in nodes],
    "edges": [[e["u"], e["v"], round(e["minutes"], 3), round(e["len"], 1), e["cls"], int(e["bridge"]), round(e["share"], 3), e["name"], e["way"],
               r5(e["mid"]), e["distFloodM"], [r5(c) for c in e["coords"]] if len(e["coords"]) > 2 else None] for e in edges],
    "edgeFields": ["u", "v", "minutes", "lengthM", "class", "bridge", "floodedShare", "name", "osmWayId", "mid", "distFloodM", "viaCoords(null=straight)"],
}, open(f"{args.out}/network.json", "w"), separators=(",", ":"))
json.dump({"places": places, "hospitals": hospitals}, open(f"{args.out}/places.json", "w"), separators=(",", ":"))
simp = flood.simplify(0.00005, preserve_topology=True)
json.dump({"type": "Feature", "properties": {"source": "UNOSAT SPOT-6 flood extent 2024-09-30 (product 3996)"}, "geometry": mapping(simp)},
          open(f"{args.out}/flood_extent.geojson", "w"), separators=(",", ":"))
json.dump({
    "area": "Kathmandu valley (UNOSAT SPOT-6 analysis extent)", "bbox": BBOX,
    "network": {"source": "OpenStreetMap via Geofabrik nepal-240101.osm.pbf", "snapshot": "2024-01-02", "licence": "ODbL (c) OpenStreetMap contributors", "phase": "pre-event",
                "speedKmhByClass": SPEED, "assumptions": ["roads undirected", "free-flow speeds are assumptions", "exact coordinate match = same node", "only motorway..residential, living_street (no service/track/path)"]},
    "hazardInput": {"source": "UNOSAT product 3996 Spot6_20240930_FloodExtent_Kathmandu", "observedOn": "2024-09-30", "phase": "post-event (used ONLY as the given hazard in hindcast mode)", "licence": "CC BY-SA"},
    "counts": {"nodes": len(nodes), "edges": len(edges), "places": len(places), "hospitals": len(hospitals), "edgesTouchingFlood": sum(e["share"] > 0 for e in edges)},
}, open(f"{args.out}/provenance.json", "w"), indent=1)
print("done")
