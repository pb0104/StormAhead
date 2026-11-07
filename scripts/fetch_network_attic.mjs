// Rebuild the road network + places from OSM at an arbitrary PRE-EVENT date, via the Overpass attic API.
//
//   node scripts/fetch_network_attic.mjs --date 2024-09-26 --out data/real/kathmandu-0926
//
// Why this exists: the committed dataset uses the Geofabrik snapshot of 2 Jan 2024, nine months before the
// event, so roads built during 2024 are missing — a documented weakness of the hindcast. Overpass attic
// queries return OSM as it stood on a given date (verified: 241,174 buildings in this box at 2018-01-01,
// 289,698 at 2021-01-01, 356,900 at 2024-01-02, 373,981 today), so a network from the day before the event
// can be built instead. docs/real-data-findings.md previously stated attic queries do not work; they do.
//
// The output matches the schema of the committed data/real/kathmandu files, so HindcastService can be pointed
// at either directory and the two runs compared. flood_extent.geojson / incidents.json / wards.json are NOT
// regenerated — copy or symlink them in, since the hazard and the ground truth are the same either way.
//
// Modelling choices are copied from scripts/prepare_kathmandu.py so the two datasets stay comparable:
// free-flow speed per highway class, roads undirected, identical coordinates = the same node, and
// service/track/path excluded. floodedShare is measured here by sampling the polyline rather than by exact
// geometric intersection, which is an approximation the Python pipeline did not make (see --step).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith("--") ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const DATE = args.date ?? "2024-09-26";
const OUT = (args.out ?? "data/real/kathmandu-0926").replace(/\/$/, "");
const FLOOD = args.flood ?? "data/real/kathmandu/flood_extent.geojson";
const STEP_M = Number(args.step ?? 5); // polyline sampling step for floodedShare
const EVENT_START = "2024-09-27T00:00:00Z";

const BBOX = [85.284, 27.587, 85.493, 27.788];
const KX = 98600.0, KY = 110600.0;
const SPEED = { motorway: 60, trunk: 40, primary: 35, secondary: 30, tertiary: 25, unclassified: 20, residential: 15, living_street: 10 };
const KEEP = new Set([...Object.keys(SPEED), ...["motorway", "trunk", "primary", "secondary", "tertiary"].map((k) => k + "_link")]);
const PLACE_TYPES = ["neighbourhood", "suburb", "quarter", "village", "hamlet", "town", "city", "locality"];

if (Date.parse(DATE) >= Date.parse(EVENT_START)) { console.error(`Refusing: ${DATE} is not before the event (${EVENT_START}).`); process.exit(1); }

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
async function overpass(body, label) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, { method: "POST", body, headers: { "User-Agent": "CascadeIQ-research-prototype/0.1", "Content-Type": "text/plain" }, signal: AbortSignal.timeout(900000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (!j.elements) throw new Error("no elements");
      return j.elements;
    } catch (err) {
      const wait = 15000 * 2 ** attempt;
      console.warn(`  ${label}: ${url} failed (${err.message}); retry in ${wait / 1000}s`);
      if (attempt === 5) throw err;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
const atticPrefix = `[out:json][timeout:880][date:"${DATE}T00:00:00Z"][bbox:${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]}];`;

// ---------- geometry helpers ----------
const distM = (a, b) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);
const key = (c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
const inRing = (lon, lat, ring) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
function segDist(lon, lat, a, b) {
  const px = lon * KX, py = lat * KY, ax = a[0] * KX, ay = a[1] * KY, bx = b[0] * KX, by = b[1] * KY;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ---------- flood extent ----------
const floodGeo = JSON.parse(readFileSync(FLOOD, "utf8"));
const polys = (floodGeo.geometry ?? floodGeo.features?.[0]?.geometry).coordinates.map((poly) => {
  const ring = poly[0];
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  return { ring, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
});
/** Grid of flood-polygon indices, so a point test only checks nearby polygons. */
const CELL = 0.002;
const grid = new Map();
polys.forEach((p, i) => {
  for (let x = Math.floor(p.bb[0] / CELL); x <= Math.floor(p.bb[2] / CELL); x++)
    for (let y = Math.floor(p.bb[1] / CELL); y <= Math.floor(p.bb[3] / CELL); y++) {
      const k = `${x},${y}`;
      (grid.get(k) ?? grid.set(k, []).get(k)).push(i);
    }
});
const inFlood = (lon, lat) => {
  for (const i of grid.get(`${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`) ?? []) {
    const p = polys[i];
    if (lon >= p.bb[0] && lon <= p.bb[2] && lat >= p.bb[1] && lat <= p.bb[3] && inRing(lon, lat, p.ring)) return true;
  }
  return false;
};
function distFloodM(lon, lat) {
  if (inFlood(lon, lat)) return 0;
  let best = Infinity;
  for (const p of polys) {
    const dx = Math.max(p.bb[0] - lon, 0, lon - p.bb[2]) * KX, dy = Math.max(p.bb[1] - lat, 0, lat - p.bb[3]) * KY;
    if (Math.hypot(dx, dy) >= best) continue;
    for (let i = 0, j = p.ring.length - 1; i < p.ring.length; j = i++) {
      const d = segDist(lon, lat, p.ring[j], p.ring[i]);
      if (d < best) best = d;
    }
  }
  return Math.round(best);
}
/** Share of a polyline's length inside the flood extent, by sampling every STEP_M metres. */
function floodedShare(coords) {
  let inside = 0, total = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i], len = distM(a, b);
    if (len === 0) continue;
    const n = Math.max(1, Math.ceil(len / STEP_M));
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n;
      total++;
      if (inFlood(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) inside++;
    }
  }
  return total ? inside / total : 0;
}

// ---------- fetch ----------
console.log(`Overpass attic @ ${DATE} (pre-event, event starts ${EVENT_START.slice(0, 10)})`);
console.log("  roads…");
const ways = await overpass(`${atticPrefix}way["highway"];out geom;`, "roads");
console.log("  places…");
const placeEls = await overpass(`${atticPrefix}node["place"~"^(${PLACE_TYPES.join("|")})$"];out;`, "places");
console.log("  hospitals…");
const hospEls = await overpass(`${atticPrefix}nwr["amenity"="hospital"];out center;`, "hospitals");

const roads = ways.filter((w) => KEEP.has(w.tags?.highway) && w.geometry?.length >= 2);
console.log(`  ${roads.length} road ways kept of ${ways.length} highway ways; ${placeEls.length} places; ${hospEls.length} hospital features`);

// ---------- graph ----------
// A coordinate shared by two or more ways is a junction; way endpoints are always junctions.
const use = new Map();
for (const w of roads) for (const g of w.geometry) { const k = key([g.lon, g.lat]); use.set(k, (use.get(k) ?? 0) + 1); }

const nodeIdx = new Map(), nodes = [];
const nodeOf = (c) => { const k = key(c); let i = nodeIdx.get(k); if (i === undefined) { i = nodes.length; nodeIdx.set(k, i); nodes.push([+c[0].toFixed(5), +c[1].toFixed(5)]); } return i; };

const edges = [];
for (const w of roads) {
  const cls = w.tags.highway.replace(/_link$/, "");
  const speed = SPEED[cls] ?? 20;
  const bridge = w.tags.bridge && w.tags.bridge !== "no" ? 1 : 0;
  const name = w.tags.name ?? null;
  const pts = w.geometry.map((g) => [g.lon, g.lat]);
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    const isEnd = i === pts.length - 1, isJunction = (use.get(key(pts[i])) ?? 0) >= 2;
    if (!isEnd && !isJunction) continue;
    const seg = pts.slice(start, i + 1);
    let lengthM = 0;
    for (let k = 1; k < seg.length; k++) lengthM += distM(seg[k - 1], seg[k]);
    if (lengthM > 0) {
      const u = nodeOf(seg[0]), v = nodeOf(seg[seg.length - 1]);
      if (u !== v) {
        const mid = seg[Math.floor(seg.length / 2)];
        edges.push({
          u, v, minutes: +((lengthM / 1000 / speed) * 60).toFixed(3), lengthM: +lengthM.toFixed(1), cls, bridge,
          share: +floodedShare(seg).toFixed(4), name, wayId: w.id,
          mid: [+mid[0].toFixed(5), +mid[1].toFixed(5)],
          via: seg.length > 2 ? seg.map((c) => [+c[0].toFixed(5), +c[1].toFixed(5)]) : null,
        });
      }
    }
    start = i;
  }
}
console.log(`  ${nodes.length} nodes, ${edges.length} edges`);
for (const e of edges) e.dist = e.share > 0 ? 0 : distFloodM(e.mid[0], e.mid[1]);

// ---------- nearest-node snapping for places and hospitals ----------
const NCELL = 0.004, ngrid = new Map();
nodes.forEach(([lon, lat], i) => { const k = `${Math.floor(lon / NCELL)},${Math.floor(lat / NCELL)}`; (ngrid.get(k) ?? ngrid.set(k, []).get(k)).push(i); });
const cellM = NCELL * Math.min(KX, KY);
function nearestNode(lon, lat) {
  const ci = Math.floor(lon / NCELL), cj = Math.floor(lat / NCELL);
  let best = -1, bestD = Infinity;
  for (let r = 0; r < 60; r++) {
    if (best >= 0 && (r - 1) * cellM > bestD) break;
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      if (r > 0 && Math.abs(i - ci) !== r && Math.abs(j - cj) !== r) continue;
      for (const n of ngrid.get(`${i},${j}`) ?? []) { const d = distM(nodes[n], [lon, lat]); if (d < bestD) { bestD = d; best = n; } }
    }
  }
  return best;
}
const inBox = (lon, lat) => lon >= BBOX[0] && lon <= BBOX[2] && lat >= BBOX[1] && lat <= BBOX[3];
const pointify = (els, typeOf) => els.flatMap((el) => {
  const lon = el.lon ?? el.center?.lon, lat = el.lat ?? el.center?.lat;
  if (lon === undefined || !inBox(lon, lat)) return [];
  return [{
    id: el.id, name: el.tags?.name ?? "", type: typeOf(el), lon: +lon.toFixed(6), lat: +lat.toFixed(6),
    node: nearestNode(lon, lat), inFlood: inFlood(lon, lat), distFloodM: distFloodM(lon, lat),
  }];
});
const places = pointify(placeEls, (el) => el.tags.place).filter((p) => p.name);
const hospitals = pointify(hospEls, () => "hospital");
console.log(`  ${places.length} named places, ${hospitals.length} hospitals`);

// ---------- write ----------
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/network.json`, JSON.stringify({
  nodes,
  edgeFields: ["u", "v", "minutes", "lengthM", "class", "bridge", "floodedShare", "name", "osmWayId", "mid", "distFloodM", "viaCoords(null=straight)"],
  edges: edges.map((e) => [e.u, e.v, e.minutes, e.lengthM, e.cls, e.bridge, e.share, e.name, e.wayId, e.mid, e.dist, e.via]),
}));
writeFileSync(`${OUT}/places.json`, JSON.stringify({ places, hospitals }, null, 1));
writeFileSync(`${OUT}/provenance.json`, JSON.stringify({
  area: "Kathmandu valley (UNOSAT SPOT-6 analysis extent)",
  bbox: BBOX,
  network: {
    source: "OpenStreetMap via Overpass attic API (overpass-api.de)",
    snapshot: DATE, licence: "ODbL (c) OpenStreetMap contributors", phase: "pre-event",
    speedKmhByClass: SPEED,
    assumptions: [
      "roads undirected", "free-flow speeds are assumptions", "exact coordinate match = same node",
      "only motorway..residential, living_street (no service/track/path)",
      `floodedShare measured by sampling the polyline every ${STEP_M} m (the Python pipeline used exact geometric intersection)`,
    ],
  },
  hazardInput: { source: "UNOSAT product 3996 Spot6_20240930_FloodExtent_Kathmandu", observedOn: "2024-09-30", phase: "post-event (used ONLY as the given hazard in hindcast mode)", licence: "CC BY-SA" },
  counts: { nodes: nodes.length, edges: edges.length, places: places.length, hospitals: hospitals.length, edgesTouchingFlood: edges.filter((e) => e.share > 0).length },
}, null, 1));

console.log(`\nWrote ${OUT}/{network,places,provenance}.json`);
console.log(`Copy the hazard and ground truth in, e.g.:\n  cp data/real/kathmandu/{flood_extent.geojson,incidents.json,wards.json} ${OUT}/`);
console.log({ nodes: nodes.length, edges: edges.length, bridges: edges.filter((e) => e.bridge).length, touchingFlood: edges.filter((e) => e.share > 0).length, places: places.length, hospitals: hospitals.length });
