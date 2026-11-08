// Census 2021 for the valley's municipalities, from the public BIPAD API (no key):
//   census_municipality.json  population, households, under-5s and 65+ per municipality, plus its official ward count
// BIPAD publishes the 2021 census per municipality ("local" level) and per district only; there is no ward-level table.
// The console therefore shows the municipality's real figures and labels any ward figure as an estimate.
// Raw responses are cached under .cache/bipad so reruns don't hit the API again.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const API = "https://bipadportal.gov.np/api/v1/";
const H = { "User-Agent": "StormAhead-research-prototype/0.1" };
const OUT = "data/real/kathmandu/", CACHE = ".cache/bipad/";
mkdirSync(CACHE, { recursive: true });

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
/** Pages until a short page: BIPAD's "next" link never ends and its count is a placeholder. */
async function all(path, page = 500) {
  const rows = [];
  for (let offset = 0; offset < page * 40; offset += page) {
    const j = await get(`${path}&limit=${page}${offset ? `&offset=${offset}` : ""}`);
    rows.push(...j.results);
    if (j.results.length < page) return rows;
  }
  throw new Error(`Too many rows in ${path}`);
}

const valley = JSON.parse(readFileSync(OUT + "wards_bipad.json", "utf8")).wards;
const ids = new Set(valley.map((w) => w.municipality));

const names = new Map((await all("municipality/?format=json")).map((m) => [m.id, m.title_en ?? m.title]));
const wardCount = new Map();
for (const w of await all("ward/?format=json")) wardCount.set(w.municipality, (wardCount.get(w.municipality) ?? 0) + 1);

const age = (g, keys) => keys.reduce((s, k) => s + (g?.male?.[k] ?? 0) + (g?.female?.[k] ?? 0), 0);
const out = [];
for (const d of await all("demographic/?format=json&census_year=2021")) {
  if (d.federalLevel !== "local" || !ids.has(d.municipality)) continue;
  out.push({
    municipality: d.municipality, name: names.get(d.municipality) ?? String(d.municipality), wards: wardCount.get(d.municipality) ?? null,
    population: d.totalPopulation, households: d.householdCount, male: d.malePopulation, female: d.femalePopulation,
    under5: age(d.ageGroupPopulation, ["00-04"]), over65: age(d.ageGroupPopulation, ["65-69", "70-74", "75+"]),
  });
}
out.sort((a, b) => b.population - a.population);
writeFileSync(OUT + "census_municipality.json", JSON.stringify({
  source: "BIPAD Portal /api/v1/demographic/ (National Population and Housing Census 2021, local level) and /api/v1/ward/ (ward counts)",
  retrievedAt: new Date().toISOString(),
  note: "Municipality-level only: BIPAD has no ward-level census. Any ward population shown in the console is an estimate (municipality ÷ its wards).",
  municipalities: out,
}, null, 1));
console.log(`municipalities: ${out.length} of ${ids.size}`, out.map((m) => `${m.name} ${m.population} (${m.wards} wards)`).join("; "));
