"""
Terrain stage of the forward pipeline: elevation -> HAND + slope, attached to roads, places, hospitals and wards.

Input  (download once, ~45 MB, no key):
  https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N27_00_E085_00_DEM/Copernicus_DSM_COG_10_N27_00_E085_00_DEM.tif
Run:   python -I scripts/prepare_terrain.py --dem <that .tif> --out data/real/kathmandu
Needs: network.json, places.json (prepare_kathmandu.py) and wards_bipad.json (fetch_pipeline_inputs.mjs) in --out.

HAND = Height Above Nearest Drainage: how far a cell sits above the stream it drains to. It uses no flood imagery, so it is
a PRE-event susceptibility layer, not a forecast. Drainage comes from a priority-flood traversal: each cell drains along the
least-cost path to the window edge, which also resolves pits and flats in the DEM. Streams are then breached rather than filled.
Limits: GLO-30 is a surface model (buildings and trees raise it), about 30 m resolution, and ward areas are approximated by
nearest-centroid (Voronoi) cells because BIPAD exposes ward centroids and bboxes rather than polygons here.
"""
import argparse, heapq, json

import numpy as np
import rasterio
import shapely
from rasterio.windows import from_bounds
from shapely.geometry import MultiPoint, Point, box, mapping

BBOX = (85.284, 27.587, 85.493, 27.788)  # analysis extent (same as prepare_kathmandu.py)
PAD = 0.07                               # include surrounding ridges so streams start at real divides
THRESHOLDS = [0.5, 1, 2, 3, 5, 8]        # metres of HAND; per-edge flooded share is stored for each
KX, KY = 98600.0, 110600.0               # metres per degree at ~27.7N
SAMPLE_M = 30.0
SLOPE_RADIUS = 3                         # cells (~90 m): a road is threatened by the slope beside it, not only under it

ap = argparse.ArgumentParser()
ap.add_argument("--dem", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--stream-km2", type=float, default=5.0, help="upstream area at which a cell counts as a stream")
args = ap.parse_args()
out = args.out.rstrip("/") + "/"

with rasterio.open(args.dem) as src:
    win = from_bounds(BBOX[0] - PAD, BBOX[1] - PAD, BBOX[2] + PAD, BBOX[3] + PAD, src.transform).round_offsets().round_lengths()
    dem = src.read(1, window=win).astype(np.float64)
    tf = src.window_transform(win)
H, W = dem.shape
dx, dy = abs(tf.a) * KX, abs(tf.e) * KY
cell_km2 = dx * dy / 1e6
print(f"DEM window {H}x{W}, cell {dx:.1f}x{dy:.1f} m, elevation {dem.min():.0f}-{dem.max():.0f} m")

# ---- priority-flood: visit cells from the edge inward, lowest first; parent = the cell each one drains to ----
N = H * W
flat = dem.ravel()
filled = flat.copy()
seen = np.zeros(N, dtype=bool)
parent = np.full(N, -1, dtype=np.int64)
order = np.empty(N, dtype=np.int64)
heap = []
for r in range(H):
    for c in (0, W - 1):
        i = r * W + c
        if not seen[i]: seen[i] = True; heap.append((flat[i], i))
for c in range(W):
    for r in (0, H - 1):
        i = r * W + c
        if not seen[i]: seen[i] = True; heap.append((flat[i], i))
heapq.heapify(heap)
NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
k = 0
while heap:
    z, i = heapq.heappop(heap)
    order[k] = i; k += 1
    r, c = divmod(i, W)
    for a, b in NB:
        rr, cc = r + a, c + b
        if 0 <= rr < H and 0 <= cc < W:
            j = rr * W + cc
            if not seen[j]:
                seen[j] = True
                parent[j] = i
                filled[j] = max(flat[j], z)
                heapq.heappush(heap, (filled[j], j))

# ---- upstream area, then HAND (parents are always visited before their children) ----
acc = np.ones(N, dtype=np.int64)
for i in order[::-1]:
    p = parent[i]
    if p >= 0: acc[p] += acc[i]
stream = acc * cell_km2 >= args.stream_km2
fill_depth = filled - flat
print(f"fill depth: max {fill_depth.max():.1f} m, cells filled > 2 m: {(fill_depth > 2).mean() * 100:.1f}%")
# Breach, do not fill: GLO-30 is a surface model, so trees and bridges in a narrow gorge act as false dams, and filling behind
# them would raise the "stream" level across the valley floor. Stream elevation is the lowest value seen so far going downstream.
carved = flat.copy()
for i in order[::-1]:
    p = parent[i]
    if p >= 0 and stream[i] and stream[p] and carved[i] < carved[p]:
        carved[p] = carved[i]
drain = np.empty(N)
for i in order:
    p = parent[i]
    drain[i] = carved[i] if (stream[i] or p < 0) else drain[p]
hand = np.maximum(flat - drain, 0).reshape(H, W)
print(f"stream cells {stream.sum()} ({stream.mean() * 100:.1f}%) at >= {args.stream_km2} km2")

# ---- slope (degrees) and its local maximum ----
gy, gx = np.gradient(dem, dy, dx)
slope = np.degrees(np.arctan(np.hypot(gx, gy)))
near = slope.copy()
for a in range(-SLOPE_RADIUS, SLOPE_RADIUS + 1):
    for b in range(-SLOPE_RADIUS, SLOPE_RADIUS + 1):
        near = np.maximum(near, np.roll(np.roll(slope, a, 0), b, 1))


def rc(lon, lat):
    c = np.clip(((np.asarray(lon) - tf.c) / tf.a).astype(int), 0, W - 1)
    r = np.clip(((np.asarray(lat) - tf.f) / tf.e).astype(int), 0, H - 1)
    return r, c


net = json.load(open(out + "network.json"))
pl = json.load(open(out + "places.json"))
wards = json.load(open(out + "wards_bipad.json"))["wards"]
nodes = net["nodes"]
wxy = np.array([[w["lon"] * KX, w["lat"] * KY] for w in wards])


def nearest_ward(lon, lat):
    p = np.column_stack([np.asarray(lon) * KX, np.asarray(lat) * KY])
    res = np.empty(len(p), dtype=np.int64)
    for s in range(0, len(p), 20000):
        q = p[s : s + 20000]
        res[s : s + 20000] = ((q[:, None, :] - wxy[None, :, :]) ** 2).sum(-1).argmin(1)
    return res


# ---- per-road sampling ----
hand_min, share, slope_near, edge_mid = [], [], [], []
for e in net["edges"]:
    pts = [nodes[e[0]]] + (e[11][1:-1] if e[11] else []) + [nodes[e[1]]]
    lon, lat = [], []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, int(np.hypot((x1 - x0) * KX, (y1 - y0) * KY) / SAMPLE_M))
        t = np.arange(n) / n
        lon.extend(x0 + (x1 - x0) * t); lat.extend(y0 + (y1 - y0) * t)
    lon.append(pts[-1][0]); lat.append(pts[-1][1])
    r, c = rc(lon, lat)
    h = hand[r, c]
    hand_min.append(round(float(h.min()), 1))
    share.append([round(float((h <= t).mean()), 2) for t in THRESHOLDS])
    slope_near.append(round(float(near[r, c].max()), 1))
    edge_mid.append(e[9])
mid = np.array(edge_mid)
edge_ward = nearest_ward(mid[:, 0], mid[:, 1])


def point_stats(items):
    if not items: return []
    r, c = rc([p["lon"] for p in items], [p["lat"] for p in items])
    return [{"hand": round(float(hand[a, b]), 1), "elev": round(float(dem[a, b]), 0), "slopeNear": round(float(near[a, b]), 1)} for a, b in zip(r, c)]


# ---- per-ward summaries over Voronoi cells inside the analysis extent ----
c0, r0 = int((BBOX[0] - tf.c) / tf.a), int((BBOX[3] - tf.f) / tf.e)
c1, r1 = int((BBOX[2] - tf.c) / tf.a), int((BBOX[1] - tf.f) / tf.e)
rr, cc = np.mgrid[r0:r1:2, c0:c1:2]  # every 2nd cell is plenty for ward means
lon = tf.c + (cc.ravel() + 0.5) * tf.a
lat = tf.f + (rr.ravel() + 0.5) * tf.e
own = nearest_ward(lon, lat)
hs, ss, zs = hand[rr, cc].ravel(), slope[rr, cc].ravel(), dem[rr, cc].ravel()
road_km = np.bincount(edge_ward, weights=[e[3] / 1000 for e in net["edges"]], minlength=len(wards))
ward_rows = []
for i, w in enumerate(wards):
    m = own == i
    if not m.any():
        r, c = rc([w["lon"]], [w["lat"]]); h_, s_, z_ = hand[r, c], slope[r, c], dem[r, c]
    else:
        h_, s_, z_ = hs[m], ss[m], zs[m]
    ward_rows.append({"id": w["id"], "elev": round(float(z_.mean()), 0), "slopeMean": round(float(s_.mean()), 1), "slopeP90": round(float(np.percentile(s_, 90)), 1),
                      "lowHandShare": round(float((h_ <= 3).mean()), 3), "roadKm": round(float(road_km[i]), 2)})

# ---- approximate ward areas for the map: the same nearest-centroid cells the summaries above use ----
to_m = lambda g: shapely.transform(g, lambda c: c * [KX, KY])
to_deg = lambda g: shapely.transform(g, lambda c: c / [KX, KY])
extent = to_m(box(*BBOX))
cells = list(shapely.voronoi_polygons(MultiPoint(wxy), extend_to=extent).geoms)
features = []
for i, w in enumerate(wards):
    cell = next(c for c in cells if c.contains(Point(wxy[i])))
    features.append({"type": "Feature", "properties": {"id": w["id"], "name": w["name"]}, "geometry": mapping(to_deg(cell.intersection(extent)).simplify(0.00005))})
json.dump({"type": "FeatureCollection", "note": "Approximate: nearest-centroid cells, not official ward boundaries.", "features": features},
          open(out + "ward_areas.geojson", "w"), separators=(",", ":"))

json.dump({
    "source": "Copernicus GLO-30 DEM (tile N27 E085), derived HAND and slope", "licence": "Copernicus DEM licence; attribution: (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA",
    "phase": "pre-event (no flood imagery used)", "streamKm2": args.stream_km2, "handThresholdsM": THRESHOLDS,
    "edges": {"handMin": hand_min, "shareBelow": share, "slopeNear": slope_near, "ward": [int(x) for x in edge_ward]},
    "places": point_stats(pl["places"]), "hospitals": point_stats(pl["hospitals"]), "wards": ward_rows,
}, open(out + "terrain.json", "w"), separators=(",", ":"))
print("edges", len(hand_min), "| wards", len(ward_rows), "| done")
