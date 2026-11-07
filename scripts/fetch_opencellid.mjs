// Fetch REAL cell-site positions for the Kathmandu valley from OpenCelliD. Output: data/real/kathmandu/cell_sites.json
//
// Needs OPENCELLID_KEY in the environment (free key from opencellid.org). Run with:
//   node --env-file=.env scripts/fetch_opencellid.mjs
//
// What is real and what is not:
//   - Positions are REAL but ESTIMATED: OpenCelliD averages where phones saw each cell, so a position can be off by
//     hundreds of metres. Several cells (sectors, 2G/3G/4G) sit on one mast, so cells within CLUSTER_M are merged into
//     one site.
//   - The database is today's (2026), not a pre-event snapshot. `firstSeen` records when each site first appeared in
//     OpenCelliD; sites first seen after the flood may not have existed then.
//   - Status during the flood is NOT public (Nepal Telecom and Ncell publish no site outages). The console MODELS it from
//     the observed flood extent and labels it as modelled. This script only records the flood join.
//
// Licence: OpenCelliD data is CC BY-SA 4.0. Attribute "OpenCelliD" wherever it is shown.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const OUT = "data/real/kathmandu/cell_sites.json";
const BBOX = [85.284, 27.587, 85.493, 27.788]; // = UNOSAT SPOT-6 analysis extent
const MCC = 429; // Nepal
const OPERATORS = { 1: "Nepal Telecom", 2: "Ncell", 3: "UTL", 4: "Smart Telecom" };
const CLUSTER_M = 150;
const EVENT_START = Date.parse("2024-09-27T00:00:00Z");
const KX = 98600.0, KY = 110600.0; // metres per degree at ~27.7N, as in prepare_kathmandu.py

const key = process.env.OPENCELLID_KEY;
if (!key) { console.error("Set OPENCELLID_KEY (see .env.example). Run: node --env-file=.env scripts/fetch_opencellid.mjs"); process.exit(1); }

console.log(`Downloading OpenCelliD cells for MCC ${MCC}…`);
const res = await fetch(`https://opencellid.org/ocid/downloads?token=${encodeURIComponent(key)}&type=mcc&file=${MCC}.csv.gz`, { signal: AbortSignal.timeout(180000) });
if (!res.ok) throw new Error(`OpenCelliD: HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
if (buf[0] !== 0x1f || buf[1] !== 0x8b) throw new Error(`OpenCelliD did not return a gzip file: ${buf.subarray(0, 200).toString()}`);
const csv = gunzipSync(buf).toString("utf8");

// Columns: radio,mcc,net,area,cell,unit,lon,lat,range,samples,changeable,created,updated,averageSignal
const cells = [];
for (const line of csv.split("\n")) {
  const c = line.split(",");
  if (c.length < 13 || !/^(GSM|UMTS|LTE|NR|CDMA)$/.test(c[0])) continue;
  const lon = +c[6], lat = +c[7];
  if (lon < BBOX[0] || lon > BBOX[2] || lat < BBOX[1] || lat > BBOX[3]) continue;
  cells.push({ radio: c[0], net: +c[2], lon, lat, range: +c[8], samples: +c[9], created: +c[11] * 1000 });
}
console.log(`  ${cells.length} cells inside the valley extent`);

// Greedy clustering: strongest-evidence cells first, each joins the first site within CLUSTER_M.
cells.sort((a, b) => b.samples - a.samples);
const sites = [];
for (const c of cells) {
  const s = sites.find((s) => Math.hypot((s.lon - c.lon) * KX, (s.lat - c.lat) * KY) <= CLUSTER_M);
  if (s) { s.members.push(c); continue; }
  sites.push({ lon: c.lon, lat: c.lat, members: [c] });
}

// Flood join against the committed observed extent.
const flood = JSON.parse(readFileSync("data/real/kathmandu/flood_extent.geojson", "utf8"));
const polys = flood.geometry.coordinates.map((poly) => {
  const ring = poly[0], xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  return { ring, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
});
const pointInRing = (lon, lat, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
function segDist(lon, lat, a, b) {
  const px = lon * KX, py = lat * KY, ax = a[0] * KX, ay = a[1] * KY, bx = b[0] * KX, by = b[1] * KY;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function floodDist(lon, lat) {
  if (polys.some((p) => lon >= p.bb[0] && lon <= p.bb[2] && lat >= p.bb[1] && lat <= p.bb[3] && pointInRing(lon, lat, p.ring))) return 0;
  let best = Infinity;
  for (const p of polys) {
    const dx = Math.max(p.bb[0] - lon, 0, lon - p.bb[2]) * KX, dy = Math.max(p.bb[1] - lat, 0, lat - p.bb[3]) * KY;
    if (Math.hypot(dx, dy) >= best) continue;
    for (let i = 0, j = p.ring.length - 1; i < p.ring.length; j = i++) best = Math.min(best, segDist(lon, lat, p.ring[j], p.ring[i]));
  }
  return Math.round(best);
}

const out = sites.map((s, i) => {
  const m = s.members, n = m.reduce((a, c) => a + c.samples, 0) || 1;
  const lon = m.reduce((a, c) => a + c.lon * c.samples, 0) / n, lat = m.reduce((a, c) => a + c.lat * c.samples, 0) / n;
  const firstSeen = Math.min(...m.map((c) => c.created));
  return {
    id: `CS-${String(i + 1).padStart(3, "0")}`,
    lon: +lon.toFixed(5), lat: +lat.toFixed(5),
    cells: m.length,
    radios: [...new Set(m.map((c) => c.radio))].sort(),
    operators: [...new Set(m.map((c) => OPERATORS[c.net] ?? `MNC ${c.net}`))].sort(),
    samples: n,
    firstSeen: new Date(firstSeen).toISOString().slice(0, 10),
    preEvent: firstSeen < EVENT_START,
    distFloodM: floodDist(lon, lat),
  };
});

const doc = {
  source: "OpenCelliD (opencellid.org), per-country download, MCC 429",
  licence: "CC BY-SA 4.0, OpenCelliD",
  retrievedAt: new Date().toISOString(),
  bbox: BBOX,
  clusterM: CLUSTER_M,
  note: "Positions are crowd-sourced estimates. Database is current, not a pre-event snapshot: see firstSeen / preEvent. Flood-time status is not public and is modelled in the console.",
  counts: { cells: cells.length, sites: out.length, preEvent: out.filter((s) => s.preEvent).length, inFlood: out.filter((s) => s.distFloodM === 0).length, within200m: out.filter((s) => s.distFloodM <= 200).length },
  sites: out,
};
writeFileSync(OUT, JSON.stringify(doc));
console.log(`  ${out.length} sites (${doc.counts.preEvent} first seen before the flood), ${doc.counts.inFlood} inside the flood extent, ${doc.counts.within200m} within 200 m`);
console.log(`Wrote ${OUT}`);
