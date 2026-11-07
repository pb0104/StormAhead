// Fetch PRE-EVENT building footprints for the Kathmandu-valley analysis extent, as shelter/evacuation targets.
// Output: data/real/kathmandu/buildings.json
//
// Source: OpenStreetMap via the Overpass *attic* API, pinned to the same 2024-01-02 snapshot date as the road
// network, so the building layer is pre-event like everything else the model is allowed to see. ODbL.
//
// Only shelter-relevant building types are fetched (~7k of ~357k buildings in the box): floor counts are tagged
// on 80% of those versus 4.8% of all buildings, so this subset can carry a real vertical-shelter judgement while
// the full set could not. Buildings with no usable building:levels keep floors: null and must NOT be guessed.
//
// Spatial joins (inFlood, distFloodM, nearest network node) are done here against the committed
// network.json / flood_extent.geojson, matching the RealPoint shape that places.json already uses, so buildings
// can be fed to the cascade engine as targets without rebuilding anything from the OSM PBF.
import { readFileSync, writeFileSync } from "node:fs";

const OUT = "data/real/kathmandu/buildings.json";
const BBOX = [85.284, 27.587, 85.493, 27.788]; // = UNOSAT SPOT-6 analysis extent
const ATTIC = "2024-01-02T00:00:00Z"; // same snapshot date as nepal-240101.osm.pbf (pre-event)
const KX = 98600.0, KY = 110600.0; // metres per degree at ~27.7N (local equirectangular, as in prepare_kathmandu.py)

// Types people can plausibly be sheltered in or evacuated from. Deliberately excludes bare `building=yes`,
// `house` and `residential`: they are the bulk of the 357k and are almost never tagged with levels.
const TYPES = ["school", "college", "university", "hospital", "civic", "government", "public", "commercial",
  "hotel", "mixed_use", "apartments", "dormitory", "church", "temple", "mosque", "monastery"];
// Floor counts above this are treated as tagging errors, not tall buildings (the box contains one "1234").
const MAX_FLOORS = 60;

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const QUERY = `[out:json][timeout:580][date:"${ATTIC}"][bbox:${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]}];` +
  `way["building"~"^(${TYPES.join("|")})$"];out geom;`;

async function overpass() {
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: "POST", body: QUERY,
        headers: { "User-Agent": "CascadeIQ-research-prototype/0.1", "Content-Type": "text/plain" },
        signal: AbortSignal.timeout(600000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (!j.elements) throw new Error("no elements in response");
      return j;
    } catch (err) {
      // Overpass returns 502/429 when its workers are busy; back off and try the other mirror.
      const wait = 15000 * 2 ** attempt;
      console.warn(`  ${url} failed (${err.message}); retrying in ${wait / 1000}s`);
      if (attempt === 5) throw err;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** Parse building:levels defensively. Returns null when absent, unparseable or implausible. */
function floorsOf(tags) {
  const raw = tags["building:levels"];
  if (raw == null) return null;
  const n = Number(String(raw).trim().split(/[;,]/)[0]); // "3;4" -> 3
  if (!Number.isFinite(n) || n <= 0 || n > MAX_FLOORS) return null;
  return Math.floor(n); // a "3.5" storey building has 3 usable full floors
}

/** Centroid and area of a footprint ring, via the shoelace formula in local metres. */
function ringMetrics(geom) {
  const pts = geom.map((p) => [p.lon * KX, p.lat * KY]);
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const cross = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    a2 += cross; cx += (pts[j][0] + pts[i][0]) * cross; cy += (pts[j][1] + pts[i][1]) * cross;
  }
  if (Math.abs(a2) < 1e-9) { // degenerate ring: fall back to the vertex mean
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return { lon: mx / KX, lat: my / KY, areaM2: 0 };
  }
  return { lon: cx / (3 * a2) / KX, lat: cy / (3 * a2) / KY, areaM2: Math.abs(a2) / 2 };
}

// ---------- spatial helpers ----------
/** Uniform grid index over points, for nearest-neighbour queries by expanding ring. */
function gridIndex(pts, cell) {
  const map = new Map();
  const key = (i, j) => `${i},${j}`;
  pts.forEach(([lon, lat], idx) => {
    const k = key(Math.floor(lon / cell), Math.floor(lat / cell));
    (map.get(k) ?? map.set(k, []).get(k)).push(idx);
  });
  const cellM = cell * Math.min(KX, KY); // conservative metres per cell
  return (lon, lat) => {
    const ci = Math.floor(lon / cell), cj = Math.floor(lat / cell);
    let best = -1, bestD = Infinity;
    for (let r = 0; r < 60; r++) {
      // Everything outside ring r is at least (r-1) cells away, so once that exceeds the best hit we are done.
      if (best >= 0 && (r - 1) * cellM > bestD) break;
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        if (r > 0 && Math.abs(i - ci) !== r && Math.abs(j - cj) !== r) continue; // ring only
        for (const idx of map.get(key(i, j)) ?? []) {
          const d = Math.hypot((pts[idx][0] - lon) * KX, (pts[idx][1] - lat) * KY);
          if (d < bestD) { bestD = d; best = idx; }
        }
      }
    }
    return [best, bestD];
  };
}

const pointInRing = (lon, lat, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Distance in metres from a point to a segment, in local metres. */
function segDist(lon, lat, a, b) {
  const px = lon * KX, py = lat * KY, ax = a[0] * KX, ay = a[1] * KY, bx = b[0] * KX, by = b[1] * KY;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ---------- main ----------
console.log(`Fetching pre-event (${ATTIC.slice(0, 10)}) building footprints from Overpass…`);
const raw = await overpass();
console.log(`  ${raw.elements.length} ways returned`);

const buildings = [];
for (const el of raw.elements) {
  if (!el.geometry || el.geometry.length < 3) continue;
  const { lon, lat, areaM2 } = ringMetrics(el.geometry);
  if (lon < BBOX[0] || lon > BBOX[2] || lat < BBOX[1] || lat > BBOX[3]) continue; // centroid outside the extent
  const t = el.tags ?? {};
  buildings.push({
    id: el.id, name: t.name ?? null, type: t.building, lon: +lon.toFixed(6), lat: +lat.toFixed(6),
    floors: floorsOf(t), areaM2: Math.round(areaM2),
    amenity: t.amenity ?? null, emergency: t.emergency ?? null,
    ring: el.geometry.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)]),
  });
}
console.log(`  ${buildings.length} footprints kept`);

console.log("Spatial joins against committed network.json / flood_extent.geojson…");
const net = JSON.parse(readFileSync("data/real/kathmandu/network.json", "utf8"));
const flood = JSON.parse(readFileSync("data/real/kathmandu/flood_extent.geojson", "utf8"));

// Flood polygons: outer rings only (the UNOSAT product has no holes), with bboxes for prefiltering.
const polys = flood.geometry.coordinates.map((poly) => {
  const ring = poly[0];
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  return { ring, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
});

const nearestNode = gridIndex(net.nodes, 0.004); // ~400 m cells
for (const b of buildings) {
  b.inFlood = polys.some((p) =>
    b.lon >= p.bb[0] && b.lon <= p.bb[2] && b.lat >= p.bb[1] && b.lat <= p.bb[3] && pointInRing(b.lon, b.lat, p.ring));
  let best = Infinity;
  for (const p of polys) {
    // Skip a polygon that cannot beat the current best, using its bbox as a lower bound.
    const dx = Math.max(p.bb[0] - b.lon, 0, b.lon - p.bb[2]) * KX;
    const dy = Math.max(p.bb[1] - b.lat, 0, b.lat - p.bb[3]) * KY;
    if (Math.hypot(dx, dy) >= best) continue;
    for (let i = 0, j = p.ring.length - 1; i < p.ring.length; j = i++) {
      const d = segDist(b.lon, b.lat, p.ring[j], p.ring[i]);
      if (d < best) best = d;
    }
  }
  b.distFloodM = b.inFlood ? 0 : Math.round(best);
  const [node] = nearestNode(b.lon, b.lat);
  b.node = node;
}

const withFloors = buildings.filter((b) => b.floors != null);
const byType = {};
for (const b of buildings) {
  const e = (byType[b.type] ??= { count: 0, withFloors: 0 });
  e.count++; if (b.floors != null) e.withFloors++;
}

writeFileSync(OUT, JSON.stringify({
  source: "OpenStreetMap via Overpass attic API (overpass-api.de)",
  snapshot: ATTIC.slice(0, 10),
  phase: "pre-event",
  licence: "ODbL (c) OpenStreetMap contributors",
  retrievedAt: new Date().toISOString(),
  bbox: BBOX,
  buildingTypes: TYPES,
  note: "Shelter-relevant building types only (~2% of buildings in the box), chosen because building:levels is tagged on " +
    "~80% of them versus ~4.8% of all buildings. floors is null where the tag is absent or implausible (>" + MAX_FLOORS +
    "); null must be treated as unknown, never as a guess. areaM2 is the footprint area, not usable floor area. " +
    "Footprint rings are OSM ways: a building mapped as a multipolygon relation is not included.",
  counts: { buildings: buildings.length, withFloors: withFloors.length, inFlood: buildings.filter((b) => b.inFlood).length, byType },
  buildings,
}, null, 1));

console.log(`\nWrote ${OUT}`);
console.log({
  buildings: buildings.length,
  withFloors: `${withFloors.length} (${Math.round((100 * withFloors.length) / buildings.length)}%)`,
  inFlood: buildings.filter((b) => b.inFlood).length,
  medianFloors: withFloors.map((b) => b.floors).sort((a, c) => a - c)[withFloors.length >> 1],
});
