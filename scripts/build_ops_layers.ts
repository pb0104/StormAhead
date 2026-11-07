/**
 * Real layers for the ops console. Run: npx tsx scripts/build_ops_layers.ts   (writes data/real/kathmandu/ops_layers.json)
 *
 * REAL (BIPAD Portal API, no key): registered hospitals, schools, IOM open spaces, fire engines and police, official alerts
 * for 20 Sep to 5 Oct 2024, and DHM river gauge readings for 25 to 30 Sep 2024. Landslides are the verified BIPAD reports
 * already in incidents.json.
 * MODELLED: each facility's status, from the existing closure rule on the pre-event road network under the observed
 * UNOSAT flood (30 Sep 2024), the same flood the console draws. Nothing here is a forecast.
 * Weather is REAL too: hourly rain from the Open-Meteo historical API (ECMWF IFS 9 km; ERA5 for comparison), 25 to 30 Sep 2024.
 * Raw API responses are cached in .cache/bipad, so reruns are offline and the API is not hit twice.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_PARAMS, isClosed, multiSourceDijkstra } from "../packages/analysis/cascade.ts";

const API = "https://bipadportal.gov.np/api/v1/", UA = { "User-Agent": "CascadeIQ-research-prototype/0.1" };
const DIR = "data/real/kathmandu/", CACHE = ".cache/bipad/", OUT = DIR + "ops_layers.json";
const BBOX = [85.284, 27.587, 85.493, 27.788];
const KX = 98600, KY = 110600;
const CENTRE: [number, number] = [85.3146, 27.7059]; // Ratna Park, central Kathmandu: the reference trip for "access"
const HAZARD: Record<number, string> = { 11: "Flood", 14: "Heavy Rainfall", 17: "Landslide", 28: "Inundation", 19: "Rainfall", 5: "Bridge Collapse", 29: "Soil Erosion", 10: "Fire" };

mkdirSync(CACHE, { recursive: true });
async function get(path: string): Promise<any> {
  const f = CACHE + createHash("sha1").update(path).digest("hex") + ".json";
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(API + path, { headers: UA, signal: AbortSignal.timeout(90000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json(); writeFileSync(f, JSON.stringify(j)); return j;
    } catch (e) { if (attempt >= 3) throw new Error(`${path}: ${(e as Error).message}`); await new Promise((ok) => setTimeout(ok, 2000 * (attempt + 1))); }
  }
}
/** Every row. The API's "next" link never ends, so stop on a short page. */
async function all(path: string, page: number): Promise<any[]> {
  const rows: any[] = [];
  for (let off = 0; off < page * 200; off += page) { const r = (await get(`${path}&limit=${page}&offset=${off}`)).results; rows.push(...r); if (r.length < page) return rows; }
  throw new Error(`Too many rows: ${path}`);
}
const inBox = (p: any) => p?.coordinates && p.coordinates[0] >= BBOX[0] && p.coordinates[0] <= BBOX[2] && p.coordinates[1] >= BBOX[1] && p.coordinates[1] <= BBOX[3];
const dm = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);
const r5 = (x: number) => Math.round(x * 1e5) / 1e5;

// ---------------- real records ----------------
const resources = async (type: string) => {
  const rows = await all(`resource/?format=json&resource_type=${type}`, 500);
  if (rows.some((r) => r.resourceType !== type)) throw new Error(`resource_type filter ignored for ${type}`);
  return rows.filter((r) => inBox(r.point)).map((r) => ({ id: r.id as number, name: String(r.title ?? "").trim(), at: [r5(r.point.coordinates[0]), r5(r.point.coordinates[1])] as [number, number], source: r.dataSource as string | null, updated: String(r.lastModifiedDate ?? "").slice(0, 10) }));
};
const NOT_HOSPITAL = /ayurved|dental|dent\b|eye|opthal|ophthal|veterinar|homeo|clinic|poly|lab\b|pharma|health ?post|nursing/i;
const dedupe = <T extends { name: string; at: [number, number] }>(xs: T[], m: number) => xs.filter((x, i) => !xs.slice(0, i).some((y) => y.name.toLowerCase() === x.name.toLowerCase() && dm(x.at, y.at) < m));

const health = await resources("health");
const hospitals = dedupe(health.filter((r) => /hospital|medical college|teaching/i.test(r.name) && !NOT_HOSPITAL.test(r.name)), 150);
// Registry detail (type, ownership, beds, emergency) for each hospital: one cached request per record.
const hospitalDetail = new Map<number, any>();
for (const h of hospitals) hospitalDetail.set(h.id, await get(`resource/${h.id}/?format=json`));
const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
const hospitalsDetailed = hospitals.map((h) => {
  const d = hospitalDetail.get(h.id) ?? {};
  return { ...h, type: d.type ?? null, ownership: d.ownership ?? d.operatorType ?? null, beds: num(d.bedCount) ?? num(d.hospitalBed), icuBeds: num(d.icuBed), emergency: d.hasEmergencyServices === true ? true : d.hasEmergencyServices === false ? false : null };
});
const schools = dedupe((await resources("education")).filter((r) => r.name), 50);
const openSpaces = dedupe((await resources("openspace")).filter((r) => r.name), 50);
const fire = await resources("fireengine");
const governance = await resources("governance");
const police = governance.filter((r) => /police|apf|armed/i.test(r.name));
const army = governance.filter((r) => /army|sena|सेना|battalion|\bgan\b|barrack/i.test(r.name));
console.log({ health: health.length, hospitals: hospitals.length, schools: schools.length, openSpaces: openSpaces.length, fire: fire.length, police: police.length, army: army.length });
console.log("army-like:", army.map((a) => a.name), "| other governance sample:", governance.filter((g) => !police.includes(g) && !army.includes(g)).slice(0, 12).map((g) => g.name));

const alertsRaw = (await all("alert/?format=json&started_on__gt=2024-09-20&started_on__lt=2024-10-05", 500)).filter((a) => inBox(a.point));
const alerts = alertsRaw.map((a) => {
  const d = a.affectedDemography ?? {};
  return { id: a.id as number, title: String(a.title), hazard: HAZARD[a.hazard] ?? `code ${a.hazard}`, startedOn: String(a.startedOn).slice(0, 16), expireOn: a.expireOn ? String(a.expireOn).slice(0, 16) : null,
    at: [r5(a.point.coordinates[0]), r5(a.point.coordinates[1])] as [number, number], wards: a.wards ?? [], verified: !!a.verified, people: (Number(d.maleCount) || 0) + (Number(d.femaleCount) || 0) || null };
}).sort((x, y) => x.startedOn.localeCompare(y.startedOn));

const stations = (await all("river-stations/?format=json", 500)).filter((s) => inBox(s.point) && typeof s.dangerLevel === "number");
const gauges = [];
for (const s of stations) {
  const rows = (await all(`river/?format=json&station=${s.id}&water_level_on__gt=2024-09-25&water_level_on__lt=2024-09-30`, 300))
    .filter((r) => typeof r.waterLevel === "number").sort((a, b) => a.waterLevelOn.localeCompare(b.waterLevelOn));
  if (!rows.length) continue;
  const peak = rows.reduce((a, b) => (b.waterLevel > a.waterLevel ? b : a));
  const first = (lvl: number) => rows.find((r) => r.waterLevel >= lvl)?.waterLevelOn.slice(0, 16) ?? null;
  gauges.push({ id: s.id as number, name: String(s.title), at: [r5(s.point.coordinates[0]), r5(s.point.coordinates[1])] as [number, number], warningLevel: s.warningLevel as number, dangerLevel: s.dangerLevel as number,
    peak: Math.round(peak.waterLevel * 100) / 100, peakAt: peak.waterLevelOn.slice(0, 16), firstWarning: first(s.warningLevel), firstDanger: first(s.dangerLevel), lastReading: rows[rows.length - 1].waterLevelOn.slice(0, 16), readings: rows.length });
}

const incidents = JSON.parse(readFileSync(DIR + "incidents.json", "utf8")).incidents as any[];
const landslides = incidents.filter((i) => i.hazard === "Landslide").map((i) => ({ id: i.id as number, title: String(i.title), on: String(i.incidentOn).slice(0, 10), at: [i.lon, i.lat] as [number, number], deaths: i.loss.deaths, injured: i.loss.injured, families: i.loss.familiesAffected }));

// ---------------- real weather: Open-Meteo historical API (ECMWF IFS 9 km, with ERA5 for comparison) ----------------
async function getUrl(url: string): Promise<any> {
  const f = CACHE + createHash("sha1").update(url).digest("hex") + ".json";
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
  const j = await r.json(); writeFileSync(f, JSON.stringify(j)); return j;
}
const N = 6, lats: number[] = [], lons: number[] = [];
for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) { lats.push(+(BBOX[1] + ((i + 0.5) * (BBOX[3] - BBOX[1])) / N).toFixed(4)); lons.push(+(BBOX[0] + ((k + 0.5) * (BBOX[2] - BBOX[0])) / N).toFixed(4)); }
const meteo = await getUrl(`https://archive-api.open-meteo.com/v1/archive?latitude=${lats.join(",")}&longitude=${lons.join(",")}&start_date=2024-09-25&end_date=2024-09-30&hourly=precipitation&models=ecmwf_ifs,era5&timezone=Asia%2FKathmandu`);
const cells = new Map<string, { at: [number, number]; ifs: number[]; era5: number[] }>();
for (const loc of Array.isArray(meteo) ? meteo : [meteo]) {
  const key = `${loc.latitude},${loc.longitude}`;
  if (!cells.has(key)) cells.set(key, { at: [loc.longitude, loc.latitude], ifs: loc.hourly.precipitation_ecmwf_ifs.map((x: number | null) => x ?? 0), era5: loc.hourly.precipitation_era5.map((x: number | null) => x ?? 0) });
}
const times: string[] = (Array.isArray(meteo) ? meteo[0] : meteo).hourly.time;
const grid = [...cells.values()];
const mean = (k: "ifs" | "era5") => times.map((_, h) => grid.reduce((a, c) => a + c[k][h]!, 0) / grid.length);
const ifsMean = mean("ifs"), era5Mean = mean("era5");
const roll24 = (v: number[]) => v.map((_, h) => (h < 23 ? 0 : v.slice(h - 23, h + 1).reduce((a, b) => a + b, 0)));
const r24 = roll24(ifsMean), endIdx = r24.indexOf(Math.max(...r24)), peakIdx = ifsMean.indexOf(Math.max(...ifsMean));
const inWindow = times.map((t) => t >= "2024-09-27" && t < "2024-09-29");
const sumIn = (v: number[]) => v.reduce((a, x, h) => a + (inWindow[h] ? x : 0), 0);
const weather = {
  source: "Open-Meteo historical weather API (archive-api.open-meteo.com), model ECMWF IFS 9 km; ERA5 shown for comparison. Data CC BY 4.0",
  times, valleyMeanMm: ifsMean.map((x) => +x.toFixed(2)),
  max24hMm: +Math.max(...r24).toFixed(1), max24hEnd: times[endIdx]!, peakMmH: +Math.max(...ifsMean).toFixed(1), peakAt: times[peakIdx]!,
  total2728Mm: +sumIn(ifsMean).toFixed(1), era5Total2728Mm: +sumIn(era5Mean).toFixed(1),
  cells: grid.map((c) => ({ at: c.at, total2728Mm: +sumIn(c.ifs).toFixed(1), peakMmH: +Math.max(...c.ifs).toFixed(1) })),
};

// ---------------- modelled status: the closure rule on real roads under the observed flood ----------------
const net = JSON.parse(readFileSync(DIR + "network.json", "utf8"));
const nodes: [number, number][] = net.nodes;
const edges = net.edges.map((e: any[]) => ({ u: e[0], v: e[1], minutes: e[2], lengthM: e[3], cls: e[4], bridge: !!e[5], floodedShare: e[6], name: e[7], osmWayId: e[8], mid: e[9], distFloodM: e[10], via: e[11] }));
const closed = edges.map((e: any) => isClosed(e, DEFAULT_PARAMS));
const adj = (skip: boolean) => { const a: { to: number; w: number }[][] = nodes.map(() => []); edges.forEach((e: any, i: number) => { if (skip && closed[i]) return; a[e.u]!.push({ to: e.v, w: e.minutes }); a[e.v]!.push({ to: e.u, w: e.minutes }); }); return a; };
const before = adj(false), after = adj(true);
const label = new Int32Array(nodes.length).fill(-1); const size: number[] = [];
for (let s = 0; s < nodes.length; s++) {
  if (label[s] !== -1 || !after[s]!.length) continue;
  const c = size.length, st = [s]; label[s] = c; let n = 0;
  while (st.length) { const u = st.pop()!; n++; for (const { to } of after[u]!) if (label[to] === -1) { label[to] = c; st.push(to); } }
  size.push(n);
}
const main = size.indexOf(Math.max(...size));
const nearestNode = (p: [number, number]) => { let b = -1, bd = Infinity; nodes.forEach((n, i) => { if (!after[i]!.length && !before[i]!.length) return; const d = dm(p, n); if (d < bd) { bd = d; b = i; } }); return { node: b, m: bd }; };
const centre = nearestNode(CENTRE).node;
const t0 = multiSourceDijkstra(before as any, [centre]), t1 = multiSourceDijkstra(after as any, [centre]);

const flood = JSON.parse(readFileSync(DIR + "flood_extent.geojson", "utf8")).geometry;
const polys: [number, number][][][] = flood.type === "MultiPolygon" ? flood.coordinates : [flood.coordinates];
const inRing = (p: [number, number], ring: [number, number][]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!; if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const inFlood = (p: [number, number]) => polys.some((poly) => inRing(p, poly[0]!) && !poly.slice(1).some((h) => inRing(p, h)));
const closedMids = edges.flatMap((e: any, i: number) => (closed[i] ? [{ mid: e.mid as [number, number], name: e.name as string | null, bridge: e.bridge as boolean }] : []));

type Status = { access: "ok" | "degraded" | "lost" | "unknown"; why: string; extraMin: number | null; nearestClosedM: number | null; nearestClosed: string | null };
function status(at: [number, number]): Status {
  const { node, m } = nearestNode(at);
  const nc = closedMids.reduce((a: any, c: any) => { const d = dm(at, c.mid); return d < a.d ? { d, c } : a; }, { d: Infinity, c: null });
  const near = { nearestClosedM: Number.isFinite(nc.d) ? Math.round(nc.d) : null, nearestClosed: nc.c ? (nc.c.name ?? (nc.c.bridge ? "an unnamed bridge" : "an unnamed road")) : null };
  if (m > 500) return { access: "unknown", why: "More than 500 m from the mapped road network, so access is not assessed.", extraMin: null, ...near };
  if (inFlood(at)) return { access: "lost", why: "Inside the observed flood extent (UNOSAT, 30 Sep 2024).", extraMin: null, ...near };
  if (label[node] !== main || !Number.isFinite(t1[node]!)) return { access: "lost", why: "Cut off: every road route to the rest of the valley crosses a closed road.", extraMin: null, ...near };
  const a = t0[node]!, b = t1[node]!, extra = Math.round(b - a);
  if (b - a >= 5 && b / Math.max(a, 0.5) >= 1.25) return { access: "degraded", why: `Detours around closed roads add about ${extra} min to the trip from central Kathmandu (${Math.round(a)} to ${Math.round(b)} min).`, extraMin: extra, ...near };
  return { access: "ok", why: `Reachable. The trip from central Kathmandu changes by ${Math.max(0, extra)} min.`, extraMin: Math.max(0, extra), ...near };
}
const withStatus = <T extends { at: [number, number] }>(xs: T[]) => xs.map((x) => ({ ...x, ...status(x.at) }));
const tia = { id: 0, name: "Tribhuvan International Airport", at: [85.3591, 27.6966] as [number, number] };

const result = {
  generatedAt: new Date().toISOString(),
  sources: {
    facilities: "BIPAD Portal /api/v1/resource/ (registered facilities; records last updated 2021 to 2023)",
    alerts: "BIPAD Portal /api/v1/alert/ (official alerts, 20 Sep to 5 Oct 2024)",
    gauges: "BIPAD Portal /api/v1/river/ (DHM hydrology feed, 25 to 30 Sep 2024)",
    landslides: "BIPAD verified incident reports, 26 Sep to 6 Oct 2024 (incidents.json)",
    status: "Modelled: closure rule (bridge touching the flood, or >= 30% of a road flooded) on the OSM 2 Jan 2024 network under the UNOSAT flood of 30 Sep 2024. Access = the road trip from central Kathmandu (Ratna Park).",
    licence: "BIPAD states no licence; confirm before redistribution.",
  },
  closedSegments: closedMids.length,
  hospitals: withStatus(hospitalsDetailed), schools: withStatus(schools), openSpaces: withStatus(openSpaces),
  responders: withStatus([...fire.map((f) => ({ ...f, type: "Fire engine" })), ...police.map((p) => ({ ...p, type: "Police" }))]),
  army: withStatus(army), airports: withStatus([tia]),
  alerts, gauges, landslides, weather,
};
writeFileSync(OUT, JSON.stringify(result));
const tally = (xs: Status[]) => xs.reduce<Record<string, number>>((a, x) => ((a[x.access] = (a[x.access] ?? 0) + 1), a), {});
console.log("closed segments", closedMids.length, "| hospitals", tally(result.hospitals), "| schools", tally(result.schools), "| open spaces", tally(result.openSpaces), "| responders", tally(result.responders), "| airport", tally(result.airports));
console.log("weather", { cells: weather.cells.length, max24h: weather.max24hMm, ending: weather.max24hEnd, peak: weather.peakMmH, at: weather.peakAt, total2728: weather.total2728Mm, era5: weather.era5Total2728Mm });
console.log("alerts", alerts.length, alerts.slice(0, 4).map((a) => `${a.startedOn} ${a.title}`), "| gauges", gauges.map((g) => `${g.name}: peak ${g.peak} (danger ${g.dangerLevel}) first danger ${g.firstDanger}`), "| landslides", landslides.length);
