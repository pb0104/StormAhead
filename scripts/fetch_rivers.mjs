// Fetch the valley's rivers and named streams as lines, for the rising-water animation in the console.
// Output: data/real/kathmandu/rivers.geojson (committed, so the demo never depends on Overpass).
//
// Source: OpenStreetMap via Overpass, current data by default. Rivers are display context, not a model input, and
// their courses do not change between snapshots; set RIVERS_ATTIC=2024-01-02T00:00:00Z to pin the pre-event snapshot
// (heavy: the public servers often run out of memory on attic geometry queries). ODbL.
// Rivers (waterway=river) are kept whole; streams only when named, so the map shows the channels people know
// (Bagmati, Bishnumati, Manohara, Hanumante, Dhobi Khola…) rather than every drainage ditch.
//
// Run: node scripts/fetch_rivers.mjs
import { writeFileSync } from "node:fs";

const OUT = "data/real/kathmandu/rivers.geojson";
const BBOX = [85.284, 27.587, 85.493, 27.788]; // = UNOSAT SPOT-6 analysis extent
const ATTIC = process.env.RIVERS_ATTIC ?? null;
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
// One clause per request: the combined attic query runs Overpass out of memory.
const CLAUSES = ['way["waterway"="river"]', 'way["waterway"="stream"]["name"]', 'way["waterway"="canal"]["name"]'];
const query = (c) => `[out:json][timeout:180]${ATTIC ? `[date:"${ATTIC}"]` : ""}[bbox:${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]}];${c};out geom;`;

async function run(q) {
  let lastErr = null;
  // Public Overpass servers are often busy (502/504): try each endpoint up to 3 times with a growing wait.
  for (let attempt = 0; attempt < 3; attempt++) for (const url of ENDPOINTS) {
    try {
      const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: q }), headers: { "User-Agent": "StormAhead/0.1 (rivers for flood animation)" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.remark && /error/i.test(j.remark)) throw new Error(j.remark); // Overpass reports failures with HTTP 200
      return j.elements ?? [];
    } catch (e) { lastErr = e; console.error(`${url}: ${e.message}`); await new Promise((r) => setTimeout(r, 8000 * (attempt + 1))); }
  }
  throw new Error(`Overpass failed: ${lastErr?.message}`);
}
const seen = new Set();
const json = { elements: [] };
for (const c of CLAUSES) for (const e of await run(query(c))) if (!seen.has(e.id)) { seen.add(e.id); json.elements.push(e); }

const r5 = (n) => Math.round(n * 1e5) / 1e5;
const features = json.elements
  .filter((e) => e.type === "way" && Array.isArray(e.geometry) && e.geometry.length > 1)
  .map((e) => ({
    type: "Feature",
    properties: { id: e.id, name: e.tags?.name ?? e.tags?.["name:en"] ?? null, kind: e.tags?.waterway ?? "stream" },
    geometry: { type: "LineString", coordinates: e.geometry.map((g) => [r5(g.lon), r5(g.lat)]) },
  }));
const byKind = features.reduce((m, f) => ((m[f.properties.kind] = (m[f.properties.kind] ?? 0) + 1), m), {});
const names = [...new Set(features.filter((f) => f.properties.kind === "river").map((f) => f.properties.name).filter(Boolean))];
writeFileSync(OUT, JSON.stringify({
  type: "FeatureCollection",
  source: ATTIC ? `OpenStreetMap via Overpass attic API, snapshot ${ATTIC}` : "OpenStreetMap via Overpass (current data)", licence: "ODbL (c) OpenStreetMap contributors",
  retrievedAt: new Date().toISOString(), bbox: BBOX, counts: byKind, rivers: names, features,
}));
console.log(`${OUT}: ${features.length} ways`, byKind, "\nrivers:", names.join(", "));
