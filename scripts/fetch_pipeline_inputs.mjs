// Fetch the inputs for the forward pipeline from the public BIPAD API (no key):
//   wards_bipad.json       ward centroids/bboxes + census for the valley (wards.json is the OSM ward boundaries, see fetch_wards.mjs)
//   gauges.json            hourly rain + river level for valley stations, monsoon windows 2021-2026
//   incidents_history.json verified incidents for the same windows (labels; never a model input for the same day)
// Raw responses are cached under .cache/bipad so reruns are cheap and the API is not hit twice.
// The API returns at most 300 rain/river rows per page and its "next" link never ends, so getAll pages until a page comes back short.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const API = "https://bipadportal.gov.np/api/v1/";
const H = { "User-Agent": "CascadeIQ-research-prototype/0.1" };
const OUT = "data/real/kathmandu/", CACHE = ".cache/bipad/";
const BBOX = [85.284, 27.587, 85.493, 27.788]; // = UNOSAT SPOT-6 analysis extent
const YEARS = [2021, 2022, 2023, 2024, 2025, 2026];
const SEASON = ["06-01", "10-15"];
const RIVER_IDS = [4, 97, 43]; // Khokana (outlet), Gaurighat (Bagmati), Gongabu (Bishnumati): metric stage + official levels
const CONCURRENCY = 3;
const HAZARD = { 10: "Fire", 11: "Flood", 14: "Heavy Rainfall", 17: "Landslide", 28: "Inundation", 5: "Bridge Collapse", 29: "Soil Erosion", 19: "Rainfall" };

mkdirSync(CACHE, { recursive: true });
const inBox = (p) => p?.coordinates && p.coordinates[0] >= BBOX[0] && p.coordinates[0] <= BBOX[2] && p.coordinates[1] >= BBOX[1] && p.coordinates[1] <= BBOX[3];

async function get(path) {
  const f = CACHE + createHash("sha1").update(path).digest("hex") + ".json";
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(path.startsWith("http") ? path : API + path, { headers: H, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      writeFileSync(f, JSON.stringify(j));
      return j;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${path}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 2000 * (attempt + 1)));
    }
  }
}
const PAGE = 300;
/** Every row in a window. Stopping at the first page would silently drop readings and look like a gauge outage. */
async function getAll(path) {
  const rows = [];
  for (let offset = 0; offset < PAGE * 40; offset += PAGE) {
    const j = await get(offset ? `${path}&offset=${offset}` : path);
    rows.push(...j.results);
    if (j.results.length < PAGE) return rows;
  }
  throw new Error(`Too many rows in ${path}`);
}
async function pool(jobs, fn) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < jobs.length) { const k = i++; await fn(jobs[k]); if (++done % 100 === 0) console.log(`  ${done}/${jobs.length}`); }
  }));
}
const day = 86400000;
function windows(year, days) {
  const out = []; const end = Date.parse(`${year}-${SEASON[1]}T00:00:00Z`);
  for (let t = Date.parse(`${year}-${SEASON[0]}T00:00:00Z`); t < end; t += days * day) {
    const iso = (x) => new Date(x).toISOString().slice(0, 10);
    out.push([iso(t - day), iso(Math.min(t + days * day, end))]); // API bounds are exclusive
  }
  return out;
}
/** Local Nepal hour key, e.g. "2024-09-27T14". API timestamps already carry +05:45, so the wall-clock prefix is local time. */
const hourKey = (s) => s.slice(0, 13);
/** Rain readings land around the hour (23:58, 00:01), so they belong to the nearest hour, not the one they are stamped in. */
const nearestHourKey = (s) => new Date(Math.round(Date.parse(s.slice(0, 19) + "Z") / 3600000) * 3600000).toISOString().slice(0, 13);
const hourIndex = (year, key) => Math.round((Date.parse(key + ":00:00Z") - Date.parse(`${year}-${SEASON[0]}T00:00:00Z`)) / 3600000);
const seasonHours = (year) => Math.round((Date.parse(`${year}-${SEASON[1]}T00:00:00Z`) - Date.parse(`${year}-${SEASON[0]}T00:00:00Z`)) / 3600000);

// ---- wards ----
console.log("wards");
const wards = [];
for (let url = "ward/?format=json&limit=500", n = 0; url && n < 40; n++) {
  const j = await get(url);
  wards.push(...j.results.filter((w) => inBox(w.centroid)));
  url = j.next && j.results.length ? j.next : null;
}
const munis = new Map();
for (let url = "municipality/?format=json&limit=500", n = 0; url && n < 5; n++) {
  const j = await get(url);
  for (const m of j.results) munis.set(m.id, m.title_en ?? m.title);
  url = j.next && j.results.length ? j.next : null;
}
const census = new Map(); // municipality -> 2021 population
for (let url = "demographic/?format=json&limit=500&census_year=2021", n = 0; url && n < 5; n++) {
  const j = await get(url);
  for (const d of j.results) if (d.municipality && d.censusYear === "2021") census.set(d.municipality, d.totalPopulation);
  url = j.next && j.results.length ? j.next : null;
}
writeFileSync(OUT + "wards_bipad.json", JSON.stringify({
  source: "BIPAD Portal /api/v1/ward/ and /api/v1/demographic/ (census 2021)", retrievedAt: new Date().toISOString(),
  note: "Centroid inside the analysis extent. BIPAD exposes centroid + bbox here, not ward polygons. Census population is per municipality, not per ward.",
  wards: wards.map((w) => ({ id: w.id, name: `${munis.get(w.municipality) ?? w.municipality}-${w.title}`, municipality: w.municipality, municipalityPop2021: census.get(w.municipality) ?? null, lon: w.centroid.coordinates[0], lat: w.centroid.coordinates[1], bbox: w.bbox })),
}));
console.log("valley wards:", wards.length);

// ---- stations ----
const rs = (await get("rain-stations/?format=json&limit=500")).results.filter((s) => inBox(s.point));
const vs = (await get("river-stations/?format=json&limit=500")).results.filter((s) => RIVER_IDS.includes(s.id));
const rainTitles = [...new Map(rs.map((s) => [s.title, s])).values()];

// ---- rain: hourly totals ----
console.log("rain stations:", rainTitles.length);
const rain = new Map(); // title -> year -> Map(hourKey -> mm)
await pool(rainTitles.flatMap((s) => YEARS.flatMap((y) => windows(y, 10).map((w) => ({ s, y, w })))), async ({ s, y, w }) => {
  const results = await getAll(`rain/?format=json&limit=300&title=${encodeURIComponent(s.title)}&measured_on__gt=${w[0]}&measured_on__lt=${w[1]}`);
  if (!rain.has(s.title)) rain.set(s.title, new Map());
  const by = rain.get(s.title);
  if (!by.has(y)) by.set(y, new Map());
  for (const r of results) {
    const v = r.averages?.find((a) => a.interval === 1)?.value;
    if (typeof v !== "number" || !r.measuredOn?.startsWith(String(y))) continue;
    const k = nearestHourKey(r.measuredOn), m = by.get(y);
    m.set(k, Math.max(m.get(k) ?? 0, v)); // duplicate feeds report the same hour; keep one value, never sum them
  }
});

// ---- river: hourly max stage ----
console.log("river stations:", vs.map((s) => s.title));
const river = new Map();
await pool(vs.flatMap((s) => YEARS.flatMap((y) => windows(y, 2).map((w) => ({ s, y, w })))), async ({ s, y, w }) => {
  const results = await getAll(`river/?format=json&limit=300&station=${s.id}&water_level_on__gt=${w[0]}&water_level_on__lt=${w[1]}`);
  if (!river.has(s.id)) river.set(s.id, new Map());
  const by = river.get(s.id);
  if (!by.has(y)) by.set(y, new Map());
  for (const r of results) {
    if (typeof r.waterLevel !== "number" || !r.waterLevelOn?.startsWith(String(y))) continue;
    const k = hourKey(r.waterLevelOn), m = by.get(y);
    m.set(k, Math.max(m.get(k) ?? -Infinity, r.waterLevel));
  }
});

// Keep full precision: 6.16499996 must not become 6.165 and then display as 6.17.
const pack = (y, m) => {
  const a = new Array(seasonHours(y)).fill(null);
  for (const [k, v] of m) { const i = hourIndex(y, k); if (i >= 0 && i < a.length) a[i] = Math.round(v * 1e8) / 1e8; }
  return a;
};
const series = (by) => Object.fromEntries([...by].filter(([, m]) => m.size).map(([y, m]) => [y, pack(y, m)]));
writeFileSync(OUT + "gauges.json", JSON.stringify({
  source: "BIPAD Portal /api/v1/rain/ and /api/v1/river/ (DHM hydrology.gov.np feed)", retrievedAt: new Date().toISOString(),
  timezone: "Asia/Kathmandu (+05:45)", season: SEASON, note: "Hourly arrays indexed from season start, local time. null = no reading (gap), never zero rain.",
  rain: rainTitles.map((s) => ({ title: s.title, lon: s.point.coordinates[0], lat: s.point.coordinates[1], elevation: s.elevation, mm: series(rain.get(s.title) ?? new Map()) })),
  river: vs.map((s) => ({ id: s.id, title: s.title, lon: s.point.coordinates[0], lat: s.point.coordinates[1], warningLevel: s.warningLevel, dangerLevel: s.dangerLevel, stage: series(river.get(s.id) ?? new Map()) })),
}));

// ---- incidents ----
console.log("incidents");
const incidents = new Map();
await pool(YEARS.flatMap((y) => windows(y, 5)), async (w) => {
  for (let url = `incident/?format=json&limit=500&expand=loss&incident_on__gt=${w[0]}&incident_on__lt=${w[1]}`, n = 0; url && n < 12; n++) {
    const j = await get(url);
    for (const x of j.results) if (x.verified && inBox(x.point)) incidents.set(x.id, x);
    url = j.next && j.results.length === 500 ? j.next : null;
  }
});
const rows = [...incidents.values()].map((x) => ({
  id: x.id, title: x.title, on: x.incidentOn.slice(0, 10), lon: x.point.coordinates[0], lat: x.point.coordinates[1], wards: x.wards ?? [],
  hazard: HAZARD[x.hazard] ?? `code ${x.hazard}`, deaths: Number(x.loss?.peopleDeathCount ?? 0) || 0, families: Number(x.loss?.familyAffectedCount ?? 0) || 0,
})).sort((a, b) => a.on.localeCompare(b.on) || a.id - b.id);
writeFileSync(OUT + "incidents_history.json", JSON.stringify({
  source: "BIPAD Portal /api/v1/incident/", retrievedAt: new Date().toISOString(), season: SEASON, years: YEARS,
  note: "Verified incidents in the analysis extent. Reported records: absence of a report is not absence of impact. Licence not stated on the API; confirm before redistribution.", incidents: rows,
}));
console.log("done", { wards: wards.length, incidents: rows.length });
