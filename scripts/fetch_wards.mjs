// Fetch Kathmandu-valley WARD boundaries (OSM admin_level=9) as the spatial unit for evaluation.
// Output: data/real/kathmandu/wards.json
//
// Why wards: BIPAD incident reports are ward-level records, so a ward is the unit the ground truth is actually
// collected in. The previous evaluation compared predicted points to incident points with a 1 km match radius,
// which is too coarse to discriminate in a dense valley (every baseline tied it). Scoring on wards replaces that
// arbitrary radius with the administrative unit response is organised around, and makes false alarms countable:
// a ward is either flagged or not, and either reported damage or not.
//
// These polygons are EVALUATION GEOMETRY ONLY. They are never an input to the model, so they cannot leak.
// They are still pinned to the pre-event attic date for consistency with the rest of the dataset.
import { writeFileSync } from "node:fs";

const OUT = "data/real/kathmandu/wards.json";
const BBOX = [85.284, 27.587, 85.493, 27.788]; // = UNOSAT SPOT-6 analysis extent
const ATTIC = "2024-09-26T00:00:00Z";
const KX = 98600.0, KY = 110600.0;

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const QUERY = `[out:json][timeout:580][date:"${ATTIC}"][bbox:${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]}];` +
  `relation["boundary"="administrative"]["admin_level"="9"];out geom;`;

async function overpass() {
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, { method: "POST", body: QUERY, headers: { "User-Agent": "CascadeIQ-research-prototype/0.1", "Content-Type": "text/plain" }, signal: AbortSignal.timeout(600000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (!j.elements) throw new Error("no elements");
      return j;
    } catch (err) {
      const wait = 15000 * 2 ** attempt;
      console.warn(`  ${url} failed (${err.message}); retrying in ${wait / 1000}s`);
      if (attempt === 5) throw err;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/**
 * Stitch a relation's `outer` member ways into closed rings. Overpass returns the ways unordered and with
 * arbitrary direction, so walk them end to end, reversing where needed, and close a ring when it returns
 * to its start. Ways that cannot be joined are dropped and counted.
 */
function stitch(members) {
  const key = (p) => `${p.lon.toFixed(7)},${p.lat.toFixed(7)}`;
  const open = members.filter((m) => m.role === "outer" && m.geometry?.length >= 2).map((m) => m.geometry.slice());
  const rings = [];
  let dropped = 0;
  while (open.length) {
    let cur = open.shift();
    for (let guard = 0; guard < 5000; guard++) {
      if (key(cur[0]) === key(cur[cur.length - 1])) break; // closed
      const tail = key(cur[cur.length - 1]);
      const i = open.findIndex((w) => key(w[0]) === tail || key(w[w.length - 1]) === tail);
      if (i === -1) break; // nothing joins: an open chain
      const [w] = open.splice(i, 1);
      cur = cur.concat((key(w[0]) === tail ? w : w.slice().reverse()).slice(1));
    }
    if (key(cur[0]) === key(cur[cur.length - 1]) && cur.length >= 4) rings.push(cur.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)]));
    else dropped++;
  }
  return { rings, dropped };
}

/** Ring area in m², shoelace in local metres. Used to pick the main ring and to report ward size. */
function ringAreaM2(ring) {
  let a2 = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a2 += (ring[j][0] * KX) * (ring[i][1] * KY) - (ring[i][0] * KX) * (ring[j][1] * KY);
  return Math.abs(a2) / 2;
}
function centroid(ring) {
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a2 += cross; cx += (ring[j][0] + ring[i][0]) * cross; cy += (ring[j][1] + ring[i][1]) * cross;
  }
  if (Math.abs(a2) < 1e-12) return ring[0];
  return [+(cx / (3 * a2)).toFixed(6), +(cy / (3 * a2)).toFixed(6)];
}

console.log(`Fetching ward boundaries (OSM admin_level=9, ${ATTIC.slice(0, 10)})…`);
const raw = await overpass();
console.log(`  ${raw.elements.length} ward relations`);

const wards = [];
let totalDropped = 0;
for (const el of raw.elements) {
  const { rings, dropped } = stitch(el.members ?? []);
  totalDropped += dropped;
  if (!rings.length) continue;
  // Keep every closed ring; the largest is the ward body and the rest are detached parts.
  rings.sort((a, b) => ringAreaM2(b) - ringAreaM2(a));
  const t = el.tags ?? {};
  wards.push({
    id: el.id,
    name: t.name ?? `ward ${t.ward ?? "?"}`,
    ward: t.ward ?? null,
    municipality: (t.name ?? "").replace(/-\d+$/, "") || null,
    areaM2: Math.round(rings.reduce((s, r) => s + ringAreaM2(r), 0)),
    at: centroid(rings[0]),
    rings,
  });
}

const areas = wards.map((w) => w.areaM2).sort((a, b) => a - b);
writeFileSync(OUT, JSON.stringify({
  source: "OpenStreetMap via Overpass attic API, boundary=administrative + admin_level=9 (ward)",
  snapshot: ATTIC.slice(0, 10),
  licence: "ODbL (c) OpenStreetMap contributors",
  retrievedAt: new Date().toISOString(),
  bbox: BBOX,
  role: "EVALUATION ONLY — the spatial unit predictions and incident reports are both aggregated to. Never a model input.",
  note: "Wards whose outer ways could not be stitched into a closed ring are omitted. Ward boundaries in OSM are " +
    "community-mapped and may not match the official cadastre exactly; they are used here as a consistent unit, not as a legal boundary.",
  counts: { wards: wards.length, unstitchedRings: totalDropped },
  wards,
}, null, 1));

console.log(`\nWrote ${OUT}`);
console.log({
  wards: wards.length,
  unstitchedRings: totalDropped,
  medianAreaKm2: +(areas[areas.length >> 1] / 1e6).toFixed(2),
  smallestKm2: +(areas[0] / 1e6).toFixed(2),
  largestKm2: +(areas[areas.length - 1] / 1e6).toFixed(2),
});
