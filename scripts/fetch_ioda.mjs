// Fetch REAL internet-connectivity signals for the flood window from IODA (Georgia Tech Internet Outage Detection
// and Analysis). No key needed. Output: data/real/kathmandu/ioda.json
//
// IODA has no city-level signal. The finest unit covering the valley is the old "Bagmati" zone (region 3024), so the
// result is REGIONAL: it shows *that* connectivity dropped on the flood night, not *where* inside the valley.
//
// Signals kept:
//   bgp           number of IP networks (/24 blocks) announced on the internet from the region
//   ping-slash24  number of /24 blocks that answer active probing
// Both are hourly means. Baseline = median of the 7 days before rain began (20–26 Sep 2024).
import { writeFileSync } from "node:fs";

const OUT = "data/real/kathmandu/ioda.json";
const API = "https://api.ioda.inetintel.cc.gatech.edu/v2";
const FROM = Date.UTC(2024, 8, 20) / 1000;  // 20 Sep 2024 00:00 UTC
const UNTIL = Date.UTC(2024, 9, 6) / 1000;  // 6 Oct 2024 00:00 UTC
const BASE_END = Date.UTC(2024, 8, 27) / 1000; // rain began 27 Sep
const ENTITIES = [["region", "3024", "Bagmati zone (includes Kathmandu valley)"], ["country", "NP", "Nepal"]];
const SOURCES = ["bgp", "ping-slash24"];
const HOUR = 3600;

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

async function signals(type, code) {
  const url = `${API}/signals/raw/${type}/${code}?from=${FROM}&until=${UNTIL}`;
  const res = await fetch(url, { headers: { "User-Agent": "CascadeIQ-research-prototype/0.1" }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`IODA ${type}/${code}: HTTP ${res.status}`);
  return (await res.json()).data[0];
}

const out = {
  source: "IODA, Georgia Tech (api.ioda.inetintel.cc.gatech.edu/v2)",
  licence: "IODA data is free for research use; credit IODA. Check terms before commercial use.",
  retrievedAt: new Date().toISOString(),
  window: { from: new Date(FROM * 1000).toISOString(), until: new Date(UNTIL * 1000).toISOString() },
  baseline: "median of hourly values, 20–26 Sep 2024 (before the rain)",
  note: "Regional signal. It cannot locate outages inside the valley.",
  entities: [],
};

for (const [type, code, label] of ENTITIES) {
  console.log(`IODA ${type}/${code} (${label})…`);
  const raw = await signals(type, code);
  const ent = { type, code, label, series: {} };
  for (const src of SOURCES) {
    const s = raw.find((x) => x.datasource === src);
    if (!s) { console.log(`  ${src}: missing`); continue; }
    const per = Math.max(1, Math.round(HOUR / s.step));
    const t = [], v = [];
    for (let i = 0; i < s.values.length; i += per) {
      const chunk = s.values.slice(i, i + per).filter((x) => typeof x === "number");
      t.push(s.from + i * s.step);
      v.push(chunk.length ? Math.round(chunk.reduce((a, b) => a + b, 0) / chunk.length) : null);
    }
    const base = median(v.filter((x, i) => x != null && t[i] < BASE_END));
    let minV = Infinity, minT = null;
    v.forEach((x, i) => { if (x != null && t[i] >= BASE_END && t[i] < BASE_END + 3 * 86400 && x < minV) { minV = x; minT = t[i]; } });
    const dropPct = base ? Math.round(((base - minV) / base) * 1000) / 10 : null;
    ent.series[src] = { stepSec: HOUR, t0: t[0], values: v, baseline: base, floodMin: minV, floodMinAt: new Date(minT * 1000).toISOString(), dropPct };
    console.log(`  ${src}: baseline ${base}, lowest ${minV} at ${new Date(minT * 1000).toISOString()} (−${dropPct}%)`);
  }
  out.entities.push(ent);
}

writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${OUT}`);
