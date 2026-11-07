/**
 * Forecast agents. One per factor the operator can pick. Each agent reads REAL cached data for the Kathmandu valley
 * (Sep 2024 replay), reports what it reads and computes as steps, and returns findings plus map alerts with coordinates.
 *
 * Replay rule: the scenario clock is fixed before the 27–28 Sep 2024 floods. Rain and river values inside the forecast window
 * are what was actually observed, used as a perfect-forecast stand-in. Every agent says so in its caveats. Coordinates always
 * come from data, never from the LLM.
 */
import { readFileSync } from "node:fs";
import type { Services } from "../../../packages/app/index.ts";

// ---------------------------------------------------------------- time (local Nepal time, naive)
/** Gauge arrays are hourly from season start, local time. */
const SEASON0 = Date.UTC(2024, 5, 1, 0, 0);
export const NOW_LOCAL = "2024-09-26T06:00";
export const SEASON_HOURS = 3264; // 1 Jun → 15 Oct
const naive = (s: string) => Date.parse(s.length === 16 ? `${s}:00Z` : s.endsWith("Z") ? s : `${s}Z`);
export const idxOf = (local: string) => Math.round((naive(local) - SEASON0) / 3.6e6);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function when(idx: number): string {
  const d = new Date(SEASON0 + idx * 3.6e6);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:00`;
}
export const isoLocal = (idx: number) => new Date(SEASON0 + idx * 3.6e6).toISOString().slice(0, 16);
/** UTC ISO (IODA) → local season index. Nepal is UTC+05:45. */
const idxOfUtc = (iso: string) => Math.round((Date.parse(iso) + 5.75 * 3.6e6 - SEASON0) / 3.6e6);

// ---------------------------------------------------------------- data
const DATA = new URL("../../../data/", import.meta.url);
const files = new Map<string, unknown>();
export function load<T>(rel: string): T {
  if (!files.has(rel)) files.set(rel, JSON.parse(readFileSync(new URL(rel, DATA), "utf8")));
  return files.get(rel) as T;
}
/** Analysis extent (the valley). Alerts outside it are dropped: they are not this operator's area. */
export const VALLEY: [number, number, number, number] = [85.27, 27.57, 85.51, 27.80];
export const inValley = (lon: number, lat: number) => lon >= VALLEY[0] && lon <= VALLEY[2] && lat >= VALLEY[1] && lat <= VALLEY[3];
const km = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 98.6, (a[1] - b[1]) * 110.6);
const r1 = (n: number) => Math.round(n * 10) / 10;
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

type Pt = [number, number];
type Status = { access: "ok" | "degraded" | "lost" | "unknown"; why: string; extraMin: number | null };
type Ops = {
  closedSegments: number;
  hospitals: (Status & { id: number; name: string; at: Pt; beds: number | null })[];
  schools: (Status & { id: number; name: string; at: Pt })[];
  openSpaces: (Status & { id: number; name: string; at: Pt })[];
  responders: (Status & { id: number; name: string; at: Pt; type: string })[];
  army: (Status & { name: string; at: Pt })[];
  airports: (Status & { name: string; at: Pt })[];
  alerts: { id: number; title: string; hazard: string; startedOn: string; at: Pt; people?: number }[];
  gauges: { id: number; name: string; at: Pt; warningLevel: number; dangerLevel: number; peak: number; peakAt: string; firstWarning: string | null; firstDanger: string | null }[];
  weather: { times: string[]; valleyMeanMm: number[] };
};
type Gauges = {
  rain: { title: string; lon: number; lat: number; mm: Record<string, (number | null)[]> }[];
  river: { id: number; title: string; lon: number; lat: number; warningLevel: number; dangerLevel: number; stage: Record<string, (number | null)[]> }[];
};
const ops = () => load<Ops>("real/kathmandu/ops_layers.json");

let placeIdx: { name: string; at: Pt }[] | null = null;
/** Nearest named place (Latin-script OSM names) for labelling a point. */
export function nearestPlace(at: Pt): string {
  placeIdx ??= load<{ places: { name: string; lon: number; lat: number }[] }>("real/kathmandu/places.json").places
    .filter((p) => /^[A-Za-z]/.test(p.name)).map((p) => ({ name: p.name, at: [p.lon, p.lat] as Pt }));
  let best = placeIdx[0]!, bd = Infinity;
  for (const p of placeIdx) { const d = km(at, p.at); if (d < bd) { bd = d; best = p; } }
  return best.name.charAt(0).toUpperCase() + best.name.slice(1);
}

// ---------------------------------------------------------------- types
export type Severity = "severe" | "high" | "moderate" | "info";
export type Risk = "low" | "moderate" | "high" | "severe";
export type MapAlert = {
  id: string; agent: string; lon: number; lat: number; severity: Severity; title: string; detail: string;
  /** Season hour index when this is expected (null = standing condition). */
  at: number | null; when: string | null;
};
export type Findings = {
  headline: string; risk: Risk; facts: Record<string, string | number>; alerts: MapAlert[]; caveats: string[];
  /** Extra payload for the map, per agent. */
  map?: Record<string, unknown>;
};
export type StepKind = "read" | "calc" | "found";
export type Ctx = { question: string; start: number; end: number; hours: number; services: Services; memo: Map<string, unknown> };
export type StepFn = (kind: StepKind, text: string) => Promise<void>;
export type AgentDef = {
  id: string; name: string; factor: string; blurb: string; sources: string;
  run: (ctx: Ctx, step: StepFn) => Promise<Findings>;
};

const REPLAY = "Replay: values inside the window are what was observed in 2024, used as a perfect-forecast stand-in.";
const MODELLED = "Statuses are modelled from the observed 30 Sep 2024 flood on the real road network; they show what fails if that flood repeats.";

// ---------------------------------------------------------------- shared rain statistics (memoised per run)
type RainStats = {
  stations: { title: string; at: Pt; total: number; max24: number; max24End: number; peak: number; peakAt: number; hours: number }[];
  valley: (number | null)[]; total: number; max24: number; max24End: number; peak: number; peakAt: number; coverage: number;
  daily: { day: string; mm: number }[]; ref: number; ratio: number;
};
function valleyMean(stations: (number | null)[][], len: number): (number | null)[] {
  return Array.from({ length: len }, (_, h) => {
    const v = stations.map((s) => s[h]).filter((x): x is number => x !== null && x !== undefined && x >= 0);
    return v.length ? sum(v) / v.length : null;
  });
}
function rolling24(a: (number | null)[]): { max: number; end: number } {
  let s = 0, max = 0, end = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] ?? 0; if (i >= 24) s -= a[i - 24] ?? 0;
    if (s > max) { max = s; end = i; }
  }
  return { max, end };
}
let REF: number | null = null;
/** Valley-mean max 24 h rain over the observed 26–30 Sep event: the yardstick for "as bad as 2024". */
function eventRef(): number {
  if (REF !== null) return REF;
  const g = load<Gauges>("real/kathmandu/gauges.json");
  const s0 = idxOf("2024-09-26T00:00"), s1 = idxOf("2024-09-30T00:00");
  const st = g.rain.map((r) => r.mm["2024"] ?? []).filter((a) => a.length).map((a) => a.slice(s0, s1));
  return (REF = rolling24(valleyMean(st, s1 - s0)).max);
}
export function rainStats(ctx: Ctx): RainStats {
  const hit = ctx.memo.get("rain") as RainStats | undefined;
  if (hit) return hit;
  const g = load<Gauges>("real/kathmandu/gauges.json");
  const raw = g.rain.filter((r) => (r.mm["2024"] ?? []).length).map((r) => ({ title: r.title, at: [r.lon, r.lat] as Pt, mm: r.mm["2024"]!.slice(ctx.start, ctx.end) }));
  const stations = raw.map((s) => {
    const r = rolling24(s.mm);
    let peak = 0, peakAt = 0;
    s.mm.forEach((v, i) => { if ((v ?? 0) > peak) { peak = v ?? 0; peakAt = i; } });
    return { title: s.title, at: s.at, total: sum(s.mm.map((v) => v ?? 0)), max24: r.max, max24End: ctx.start + r.end, peak, peakAt: ctx.start + peakAt, hours: s.mm.filter((v) => v !== null).length };
  }).filter((s) => s.hours > 0);
  const valley = valleyMean(raw.map((s) => s.mm), ctx.hours);
  const r = rolling24(valley);
  let peak = 0, peakAt = ctx.start;
  valley.forEach((v, i) => { if ((v ?? 0) > peak) { peak = v ?? 0; peakAt = ctx.start + i; } });
  const daily: { day: string; mm: number }[] = [];
  for (let h = 0; h < ctx.hours; h += 24) daily.push({ day: when(ctx.start + h).split(",")[0]!, mm: r1(sum(valley.slice(h, h + 24).map((v) => v ?? 0))) });
  const ref = eventRef();
  const out: RainStats = {
    stations, valley, total: sum(valley.map((v) => v ?? 0)), max24: r.max, max24End: ctx.start + r.end, peak, peakAt,
    coverage: valley.filter((v) => v !== null).length / Math.max(1, ctx.hours), daily, ref, ratio: ref ? r.max / ref : 0,
  };
  ctx.memo.set("rain", out);
  return out;
}
/** How bad the window is, against the 2024 event. */
const band = (ratio: number): Risk => (ratio >= 0.8 ? "severe" : ratio >= 0.5 ? "high" : ratio >= 0.25 ? "moderate" : "low");
const sevOf = (r: Risk): Severity => (r === "severe" ? "severe" : r === "high" ? "high" : r === "moderate" ? "moderate" : "info");

// ---------------------------------------------------------------- agents
const weather: AgentDef = {
  id: "weather", name: "Weather agent", factor: "Weather", sources: "DHM rain gauges (BIPAD) · Open-Meteo ECMWF IFS",
  blurb: "Rain totals, intensity and timing across the valley.",
  async run(ctx, step) {
    const g = load<Gauges>("real/kathmandu/gauges.json");
    await step("read", `Pulling hourly rain from ${g.rain.length} DHM gauges, ${when(ctx.start)} → ${when(ctx.end)}.`);
    const rs = rainStats(ctx);
    await step("calc", `${rs.stations.length} gauges have data in the window (${Math.round(rs.coverage * 100)}% of hours). Building a valley-mean series.`);
    await step("calc", `Valley mean: ${Math.round(rs.total)} mm in total; heaviest 24 h ${Math.round(rs.max24)} mm ending ${when(rs.max24End)}.`);
    await step("calc", `Peak intensity ${r1(rs.peak)} mm/h at ${when(rs.peakAt)}.`);
    const wet = [...rs.stations].sort((a, b) => b.max24 - a.max24);
    if (wet[0]) await step("found", `Wettest gauge: ${wet[0].title}, ${Math.round(wet[0].max24)} mm in 24 h.`);
    const om = ops().weather, omIn = om.times.map((t, i) => [idxOf(t), om.valleyMeanMm[i] ?? 0] as const).filter(([i]) => i >= ctx.start && i < ctx.end);
    if (omIn.length) await step("read", `Cross-check: Open-Meteo ECMWF valley mean gives ${Math.round(sum(omIn.map(([, v]) => v)))} mm over the ${omIn.length} overlapping hours.`);
    const pct = Math.round(rs.ratio * 100);
    await step("calc", `That 24 h peak is ${pct}% of the 26–30 Sep 2024 event (${Math.round(rs.ref)} mm).`);
    const risk = band(rs.ratio);
    const alerts: MapAlert[] = wet.filter((s) => s.max24 >= 60).slice(0, 4).map((s, i) => ({
      id: `weather-${i}`, agent: "weather", lon: s.at[0], lat: s.at[1],
      severity: s.max24 >= 150 ? "severe" : s.max24 >= 100 ? "high" : "moderate",
      title: `${Math.round(s.max24)} mm in 24 h at ${s.title}`,
      detail: `Heaviest 24 h at this gauge ends ${when(s.max24End)}; peak ${r1(s.peak)} mm/h.`, at: s.max24End, when: when(s.max24End),
    }));
    // Downsample the hourly series for the client rain animation and chart.
    const hourly = rs.valley.map((v) => r1(v ?? 0));
    return {
      headline: rs.max24 < 20 ? "Mostly dry window; no heavy rain expected." : `${Math.round(rs.max24)} mm in 24 h peaking ${when(rs.max24End)}: ${pct}% of the 2024 event.`,
      risk, alerts, caveats: [REPLAY, "Gauge gaps are skipped, never counted as zero rain."],
      facts: { totalMm: Math.round(rs.total), max24hMm: Math.round(rs.max24), max24hEnds: when(rs.max24End), peakMmPerHour: r1(rs.peak), peakAt: when(rs.peakAt), wettestGauge: wet[0]?.title ?? "n/a", wettestGauge24hMm: Math.round(wet[0]?.max24 ?? 0), gaugesReporting: rs.stations.length, shareOf2024Event: `${pct}%` },
      map: { hourly, daily: rs.daily, peakAt: rs.peakAt - ctx.start, max24: rs.max24 },
    };
  },
};

const rivers: AgentDef = {
  id: "rivers", name: "River gauge agent", factor: "River gauges", sources: "DHM river stations (hydrology.gov.np via BIPAD)",
  blurb: "Which rivers cross warning and danger levels, and when.",
  async run(ctx, step) {
    const G = ops().gauges;
    await step("read", `Reading ${G.length} river stations with warning and danger levels.`);
    const hourly = load<Gauges>("real/kathmandu/gauges.json").river;
    await step("read", `${hourly.length} stations also have an hourly stage series; scanning the window for threshold crossings.`);
    const inWin = (s: string | null) => s !== null && idxOf(s) >= ctx.start && idxOf(s) < ctx.end;
    const danger = G.filter((g) => inWin(g.firstDanger)).sort((a, b) => idxOf(a.firstDanger!) - idxOf(b.firstDanger!));
    const warning = G.filter((g) => inWin(g.firstWarning) && !danger.includes(g));
    for (const h of hourly) {
      const a = (h.stage["2024"] ?? []).slice(ctx.start, ctx.end);
      const vals = a.filter((v): v is number => v !== null);
      if (!vals.length) { await step("calc", `${h.title}: no readings in the window.`); continue; }
      const max = Math.max(...vals), at = ctx.start + a.indexOf(max);
      await step("calc", `${h.title}: peaks ${r1(max)} m at ${when(at)} (warning ${h.warningLevel} m, danger ${h.dangerLevel} m)${max >= h.dangerLevel ? " — ABOVE DANGER" : max >= h.warningLevel ? " — above warning" : ""}.`);
    }
    if (danger[0]) await step("found", `${danger.length} stations cross DANGER; first is ${danger[0].name} at ${when(idxOf(danger[0].firstDanger!))}.`);
    else await step("found", warning.length ? `${warning.length} stations reach warning level; none reach danger.` : "No station reaches warning level in the window.");
    const alerts: MapAlert[] = [
      ...danger.slice(0, 5).map((g, i) => ({ id: `rivers-d${i}`, agent: "rivers", lon: g.at[0], lat: g.at[1], severity: "severe" as Severity, title: `Above danger level · ${g.name}`, detail: `Crosses danger (${g.dangerLevel} m) at ${when(idxOf(g.firstDanger!))}; peaks ${r1(g.peak)} m at ${when(idxOf(g.peakAt))}.`, at: idxOf(g.firstDanger!), when: when(idxOf(g.firstDanger!)) })),
      ...warning.slice(0, 3).map((g, i) => ({ id: `rivers-w${i}`, agent: "rivers", lon: g.at[0], lat: g.at[1], severity: "high" as Severity, title: `Above warning · ${g.name}`, detail: `Crosses warning (${g.warningLevel} m) at ${when(idxOf(g.firstWarning!))}.`, at: idxOf(g.firstWarning!), when: when(idxOf(g.firstWarning!)) })),
    ];
    const risk: Risk = danger.length >= 3 ? "severe" : danger.length ? "high" : warning.length ? "moderate" : "low";
    return {
      headline: danger.length ? `${danger.length} of ${G.length} stations go above danger, first ${when(idxOf(danger[0]!.firstDanger!))}.` : warning.length ? `${warning.length} stations reach warning; none reach danger.` : "Rivers stay below warning levels.",
      risk, alerts, caveats: [REPLAY],
      facts: { stations: G.length, aboveDanger: danger.length, aboveWarningOnly: warning.length, firstDanger: danger[0] ? `${danger[0].name}, ${when(idxOf(danger[0].firstDanger!))}` : "none" },
    };
  },
};

const terrain: AgentDef = {
  id: "terrain", name: "Flood & runoff agent", factor: "Terrain & flooding", sources: "Terrarium elevation · UNOSAT extent · D8 runoff",
  blurb: "Where water pools and how deep, from rain over real terrain.",
  async run(ctx, step) {
    const rs = rainStats(ctx);
    const rainIn = Math.min(40, Math.max(0, r1(rs.max24 / 25.4)));
    await step("read", `Taking the heaviest 24 h from the rain gauges: ${Math.round(rs.max24)} mm (${rainIn} in).`);
    await step("read", "Reading elevation tiles and ranking the observed flood patches by how low they sit.");
    const a = await ctx.services.assessment.run(rainIn, 3);
    await step("calc", a.terrain.note);
    await step("calc", a.flowText.replace(/^Flow agent: /, "Runoff: "));
    const feats = (a.floodFc.features as { properties?: { d?: number }; geometry: { type: string; coordinates: any } }[])
      .map((f) => {
        const ring: Pt[] = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates[0][0] : [];
        const c: Pt = ring.length ? [sum(ring.map((p) => p[0])) / ring.length, sum(ring.map((p) => p[1])) / ring.length] : [0, 0];
        return { d: Number(f.properties?.d ?? 0), c };
      }).filter((f) => f.d > 0 && f.c[0] !== 0).sort((x, y) => y.d - x.d);
    await step("found", `${a.wet} of ${feats.length ? a.floodFc.features.length : a.wet} flood patches hold water; deepest about ${r1(a.deepest)} m.`);
    const picked: typeof feats = [];
    for (const f of feats) { if (picked.every((p) => km(p.c, f.c) > 1.5)) picked.push(f); if (picked.length >= 4) break; }
    const alerts: MapAlert[] = picked.map((f, i) => ({
      id: `terrain-${i}`, agent: "terrain", lon: f.c[0], lat: f.c[1], severity: f.d >= 1.5 ? "severe" : f.d >= 0.8 ? "high" : "moderate",
      title: `Flood water ~${r1(f.d)} m deep near ${nearestPlace(f.c)}`, detail: "Depth from rain over real elevation (illustrative depth model, not a hydraulic simulation).",
      at: rs.max24End, when: when(rs.max24End),
    }));
    const risk: Risk = a.deepest >= 1.5 ? "severe" : a.deepest >= 0.8 ? "high" : a.wet ? "moderate" : "low";
    return {
      headline: a.wet ? `${a.wet} flood patches wet, deepest ~${r1(a.deepest)} m; runoff pools in ${a.flow ? r1(a.flow.pooledKm2) : 0} km².` : "Not enough rain to put water in the flood patches.",
      risk, alerts, caveats: ["Depth model is illustrative: depth scales with rain relative to a 10 in reference.", "It can show less water than the observed extent, never more area."],
      facts: { rainUsedIn: rainIn, wetPatches: a.wet, deepestM: r1(a.deepest), pooledKm2: a.flow ? r1(a.flow.pooledKm2) : 0 },
      map: { rainIn },
    };
  },
};

const satellite: AgentDef = {
  id: "satellite", name: "Satellite agent", factor: "Satellite", sources: "UNOSAT SPOT-6 · Maxar Open Data · NASA Black Marble",
  blurb: "What imagery shows about where water went and what it can't see.",
  async run(ctx, step) {
    const fx = load<{ geometry: { coordinates: Pt[][][] } }>("real/kathmandu/flood_extent.geojson");
    const polys = fx.geometry.coordinates;
    await step("read", `Loading UNOSAT SPOT-6 flood extent (30 Sep 2024): ${polys.length} polygons.`);
    const area = (ring: Pt[]) => { let s = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j]![0] - ring[i]![0]) * 98.6 * (ring[j]![1] + ring[i]![1]) * 110.6 / 2; return Math.abs(s); };
    const sized = polys.map((p) => ({ a: area(p[0] ?? []), c: (p[0] ?? []).reduce<Pt>((acc, q, _i, arr) => [acc[0] + q[0] / arr.length, acc[1] + q[1] / arr.length], [0, 0]) })).sort((x, y) => y.a - x.a);
    const total = sum(sized.map((s) => s.a));
    await step("calc", `Observed water covered ${r1(total)} km²; the largest patch is ${r1(sized[0]?.a ?? 0)} km² near ${nearestPlace(sized[0]!.c)}.`);
    const merged = load<{ features: { properties: { kind?: string; type?: string } }[] }>("real/kathmandu/merged.geojson");
    const foot = merged.features.filter((f) => (f.properties.kind ?? f.properties.type) === "maxar_footprint").length;
    await step("read", `Maxar Open Data: ${foot} image footprints over the valley; the only post-event scene (6 Oct) is about half cloud.`);
    const nl = load<{ counts: { lit: number; dark: number; areas: number } }>("real/kathmandu/night_lights.json");
    await step("read", `NASA Black Marble: ${nl.counts.lit} lit cells tracked, ${nl.counts.dark} went dark after the flood.`);
    const rs = rainStats(ctx);
    await step("found", rs.ratio >= 0.5 ? "Window rain is comparable to 2024, so the observed footprint is the best guide to where water returns." : "Window rain is well below 2024; the observed footprint is an upper bound.");
    const alerts: MapAlert[] = sized.slice(0, 3).map((s, i) => ({
      id: `satellite-${i}`, agent: "satellite", lon: s.c[0], lat: s.c[1], severity: rs.ratio >= 0.5 ? "high" : "moderate",
      title: `Flooded in 2024 · ${r1(s.a)} km² near ${nearestPlace(s.c)}`, detail: "UNOSAT optical extent, 30 Sep 2024. Likely under-detects urban flooding.", at: null, when: null,
    }));
    return {
      headline: `2024 imagery puts water over ${r1(total)} km²; ${rs.ratio >= 0.5 ? "expect a similar footprint" : "treat it as the upper bound"}.`,
      risk: band(rs.ratio), alerts,
      caveats: ["Optical imagery can't see under cloud or dense urban cover; SAR showed zero flood pixels here.", "Maxar Open Data is CC BY-NC 4.0 (non-commercial)."],
      facts: { observedFloodKm2: r1(total), floodPolygons: polys.length, maxarFootprints: foot, darkCellsAfterFlood: nl.counts.dark },
    };
  },
};

const roads: AgentDef = {
  id: "roads", name: "Roads & access agent", factor: "Roads & access", sources: "OpenStreetMap network · closure rule · Dijkstra access",
  blurb: "Which roads close, which areas get cut off, which hospitals lose access.",
  async run(ctx, step) {
    const O = ops(), rs = rainStats(ctx);
    const scene = await ctx.services.scene.load();
    await step("read", "Loading the pre-event OSM road graph (2 Jan 2024, 38,038 segments).");
    await step("calc", `Closure rule (bridge touching water, or ≥30% flooded) closes ${O.closedSegments} segments under the observed flood.`);
    const closures = scene.entities.filter((e) => e.kind === "closure"), pockets = scene.entities.filter((e) => e.kind === "pocket");
    const bridges = closures.filter((c) => c.props.bridge === true || c.props.bridge === "true" || c.props.bridge === 1);
    await step("calc", `Main-road impact: ${closures.length} key closures (${bridges.length} bridges) and ${pockets.length} cut-off pockets.`);
    const hLost = O.hospitals.filter((h) => h.access === "lost"), hDeg = O.hospitals.filter((h) => h.access === "degraded");
    await step("calc", `Hospital access from shortest paths: ${hLost.length} lost, ${hDeg.length} degraded, of ${O.hospitals.length}.`);
    const risk = band(rs.ratio);
    await step("found", risk === "low" ? "Window rain is far below 2024; closures unlikely beyond local ponding." : `At ${Math.round(rs.ratio * 100)}% of 2024 rain, expect closures from ${when(rs.max24End - 12)}.`);
    const eta = rs.max24End - 6, sev = sevOf(risk);
    const alerts: MapAlert[] = risk === "low" ? [] : [
      ...pockets.slice(0, 4).map((p, i) => ({ id: `roads-p${i}`, agent: "roads", lon: p.at[0], lat: p.at[1], severity: sev, title: `Cut-off pocket near ${nearestPlace(p.at)}`, detail: `${p.props.segments ?? "Several"} road segments lose their link to the main network.`, at: eta, when: when(eta) })),
      ...bridges.slice(0, 3).map((b, i) => ({ id: `roads-b${i}`, agent: "roads", lon: b.at[0], lat: b.at[1], severity: sev, title: `Bridge likely closed near ${nearestPlace(b.at)}`, detail: "Bridge touches the flood extent.", at: eta, when: when(eta) })),
    ];
    return {
      headline: risk === "low" ? "Network stays open; no cut-offs expected." : `${closures.length} key closures and ${pockets.length} cut-off pockets if 2024 water returns.`,
      risk, alerts, caveats: [MODELLED, "Closure and pocket set is the engine's snapshot; stages are illustrative."],
      facts: { closedSegments: O.closedSegments, keyClosures: closures.length, bridgesClosed: bridges.length, cutOffPockets: pockets.length, hospitalsAccessLost: hLost.length, hospitalsDegraded: hDeg.length },
    };
  },
};

const cellular: AgentDef = {
  id: "cellular", name: "Cell network agent", factor: "Cellular", sources: "OpenCelliD sites · IODA internet signal",
  blurb: "Cell sites near water and how far connectivity drops.",
  async run(ctx, step) {
    const C = load<{ counts: { sites: number; cells: number }; sites: { id: string; lon: number; lat: number; cells: number; distFloodM: number; operators: string[] }[] }>("real/kathmandu/cell_sites.json");
    await step("read", `Loading ${C.counts.sites} OpenCelliD sites (${C.counts.cells} cells) in the valley.`);
    const inF = C.sites.filter((s) => s.distFloodM <= 0), near = C.sites.filter((s) => s.distFloodM > 0 && s.distFloodM <= 200);
    await step("calc", `${inF.length} sites sit inside the observed flood; ${near.length} more within 200 m.`);
    const io = load<{ entities: { label: string; series: Record<string, { baseline: number; floodMin: number; floodMinAt: string; dropPct: number }> }[] }>("real/kathmandu/ioda.json");
    const bag = io.entities[0]!.series["bgp"]!;
    const ioIn = idxOfUtc(bag.floodMinAt) >= ctx.start && idxOfUtc(bag.floodMinAt) < ctx.end;
    await step("read", `IODA (${io.entities[0]!.label}): routed networks fell ${bag.dropPct}% below baseline at ${when(idxOfUtc(bag.floodMinAt))}${ioIn ? " — inside this window" : " — outside this window"}.`);
    const rs = rainStats(ctx), risk = band(rs.ratio);
    // Cluster at-risk sites at ~1 km.
    const atRisk = [...inF, ...near].sort((a, b) => a.distFloodM - b.distFloodM);
    const groups: { at: Pt; sites: typeof atRisk }[] = [];
    for (const s of atRisk) {
      const g = groups.find((x) => km(x.at, [s.lon, s.lat]) < 1);
      if (g) g.sites.push(s); else groups.push({ at: [s.lon, s.lat], sites: [s] });
    }
    groups.sort((a, b) => sum(b.sites.map((s) => s.cells)) - sum(a.sites.map((s) => s.cells)));
    await step("found", `${groups.length} clusters of at-risk sites; the largest has ${groups[0]?.sites.length ?? 0} sites near ${groups[0] ? nearestPlace(groups[0].at) : "n/a"}.`);
    const alerts: MapAlert[] = risk === "low" ? [] : groups.slice(0, 4).map((g, i) => {
      const cells = sum(g.sites.map((s) => s.cells)), wet = g.sites.some((s) => s.distFloodM <= 0);
      return { id: `cellular-${i}`, agent: "cellular", lon: g.at[0], lat: g.at[1], severity: wet ? sevOf(risk) : "moderate", title: `${g.sites.length} cell sites at risk near ${nearestPlace(g.at)}`, detail: `${cells} cells${wet ? ", some inside the flood extent" : " within 200 m of water"}. Power loss at the mast is the usual failure.`, at: rs.max24End, when: when(rs.max24End) };
    });
    return {
      headline: risk === "low" ? "Network should hold; no flood exposure at this rain." : `${inF.length + near.length} sites near water; expect a ~${bag.dropPct}% connectivity dip at the peak.`,
      risk, alerts, caveats: ["Site positions are crowd-sourced estimates.", "IODA is regional; it cannot locate outages inside the valley.", MODELLED],
      facts: { sites: C.counts.sites, sitesInFlood: inF.length, sitesWithin200m: near.length, iodaDropPct: bag.dropPct, iodaLowAt: when(idxOfUtc(bag.floodMinAt)) },
    };
  },
};

const power: AgentDef = {
  id: "power", name: "Power grid agent", factor: "Power grid", sources: "NASA Black Marble VNP46A2 night lights",
  blurb: "Areas likely to lose power, from night-light drops.",
  async run(ctx, step) {
    const N = load<{ counts: { lit: number; dark: number; dim: number; areas: number; controlFalseDarkRate: number }; areas: { id: string; name: string; areaKm2: number; lon: number; lat: number; medianRatio: number; cells: number }[] }>("real/kathmandu/night_lights.json");
    await step("read", `Reading NASA Black Marble: ${N.counts.lit} lit cells, baseline 19 Aug onward.`);
    await step("calc", `${N.counts.dark} cells went dark and ${N.counts.dim} dim after the flood; false-dark rate on a control night ${(N.counts.controlFalseDarkRate * 100).toFixed(1)}%.`);
    const areas = [...N.areas].sort((a, b) => b.areaKm2 * (1 - b.medianRatio) - a.areaKm2 * (1 - a.medianRatio));
    await step("calc", `Grouped into ${areas.length} dark areas, ${r1(sum(areas.map((a) => a.areaKm2)))} km² in total.`);
    const rs = rainStats(ctx), risk = band(rs.ratio);
    await step("found", risk === "low" ? "Rain too light to repeat the 2024 outages." : `Largest likely outage: ${areas[0]!.name.replace(/^Dark area near /, "")} (${r1(areas[0]!.areaKm2)} km², ${Math.round(areas[0]!.medianRatio * 100)}% of normal light).`);
    const alerts: MapAlert[] = risk === "low" ? [] : areas.slice(0, 4).map((a, i) => ({
      id: `power-${i}`, agent: "power", lon: a.lon, lat: a.lat, severity: a.medianRatio < 0.4 ? sevOf(risk) : "moderate",
      title: `Likely outage · ${a.name.replace(/^Dark area near /, "")}`, detail: `${r1(a.areaKm2)} km² dropped to ${Math.round(a.medianRatio * 100)}% of normal night light after the 2024 flood.`, at: rs.max24End + 6, when: when(rs.max24End + 6),
    }));
    return {
      headline: risk === "low" ? "Grid expected to hold." : `${areas.length} areas (${r1(sum(areas.map((a) => a.areaKm2)))} km²) likely lose power if 2024 repeats.`,
      risk, alerts, caveats: ["Night lights show likely power loss, not its cause; 26–28 Sep nights were clouded or missing."],
      facts: { darkAreas: areas.length, darkKm2: r1(sum(areas.map((a) => a.areaKm2))), darkCells: N.counts.dark, worstArea: areas[0]?.name ?? "n/a" },
    };
  },
};

const social: AgentDef = {
  id: "social", name: "Social signal agent", factor: "Social media", sources: "Reddit r/Nepal (Arctic Shift), translated offline",
  blurb: "What people report: damage, needs, rescues, by place.",
  async run(ctx, step) {
    type Post = { hour_local: string; excerpt: string; translation: string; district: string; lon: number | null; lat: number | null; tags: string; outlet: string };
    const F = load<Post[]>("social/kathmandu-2024-09/feed.json");
    await step("read", `Scanning ${F.length} flood posts from r/Nepal for the window.`);
    const inWin = F.filter((p) => { const i = idxOf(p.hour_local); return i >= ctx.start && i < ctx.end; });
    const tagCount = new Map<string, number>();
    for (const p of inWin) for (const t of p.tags.split(/[|,;]/).map((x) => x.trim()).filter(Boolean)) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    const top = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    await step("calc", `${inWin.length} posts fall in the window; ${inWin.filter((p) => p.lon !== null).length} can be placed, ${inWin.filter((p) => p.lon !== null && p.lat !== null && inValley(p.lon, p.lat)).length} inside the valley.`);
    if (top.length) await step("calc", `Top themes: ${top.map(([t, n]) => `${t.replace(/_/g, " ")} (${n})`).join(", ")}.`);
    const urgent = inWin.filter((p) => p.lon !== null && p.lat !== null && inValley(p.lon, p.lat) && /request|urgent|injured|missing|rescue|displaced/.test(p.tags));
    await step("found", urgent.length ? `${urgent.length} posts inside the valley ask for help or report injuries, rescues or displacement.` : "No located help requests inside the valley in this window.");
    const picked: Post[] = [];
    for (const p of urgent) { if (picked.every((q) => km([q.lon!, q.lat!], [p.lon!, p.lat!]) > 0.6)) picked.push(p); if (picked.length >= 4) break; }
    const alerts: MapAlert[] = picked.map((p, i) => {
      const text = (p.translation || p.excerpt).replace(/\s+/g, " ").trim();
      return { id: `social-${i}`, agent: "social", lon: p.lon!, lat: p.lat!, severity: /injured|missing|rescue/.test(p.tags) ? "high" : "moderate", title: `Help request · ${nearestPlace([p.lon!, p.lat!])}`, detail: `“${text.length > 160 ? `${text.slice(0, 157)}…` : text}” (${p.outlet})`, at: idxOf(p.hour_local), when: when(idxOf(p.hour_local)) };
    });
    const risk: Risk = urgent.length >= 6 ? "high" : urgent.length ? "moderate" : "low";
    return {
      headline: inWin.length ? `${inWin.length} posts; ${urgent.length} located help or rescue reports.` : "Quiet online: no flood posts in this window.",
      risk, alerts, caveats: ["Reddit only; place matched by name, so locations are approximate.", "Area level only: no individual is tracked."],
      facts: { posts: inWin.length, located: inWin.filter((p) => p.lon !== null).length, helpRequests: urgent.length, topThemes: top.map(([t]) => t.replace(/_/g, " ")).join(", ") || "none" },
    };
  },
};

const facilities: AgentDef = {
  id: "facilities", name: "Facilities & shelter agent", factor: "Facilities & shelter", sources: "BIPAD facilities · Google Places · OSM buildings",
  blurb: "Hospitals, schools, care homes and shelter capacity at risk.",
  async run(ctx, step) {
    const O = ops(), rs = rainStats(ctx), risk = band(rs.ratio);
    await step("read", `Loading BIPAD facilities: ${O.hospitals.length} hospitals, ${O.schools.length} schools, ${O.openSpaces.length} open spaces, ${O.responders.length} responder bases.`);
    const at = <T extends Status>(a: T[]) => ({ lost: a.filter((x) => x.access === "lost"), deg: a.filter((x) => x.access === "degraded") });
    const h = at(O.hospitals), s = at(O.schools), r = at(O.responders), os = O.openSpaces.filter((o) => o.access === "ok");
    await step("calc", `Hospitals: ${h.lost.length} lose access, ${h.deg.length} degraded. Schools: ${s.lost.length} lost, ${s.deg.length} degraded.`);
    await step("calc", `Responder bases cut off: ${r.lost.length}. Usable open spaces for shelter: ${os.length}.`);
    const g = load<{ careHomes: unknown[] }>("real/kathmandu/google_places.json");
    await step("read", `Google Places: ${g.careHomes.length} care homes (mobility-limited residents) to check.`);
    await step("found", risk === "low" ? "No facility is expected to lose access at this rain." : `${h.lost.length + h.deg.length} hospitals and ${s.lost.length + s.deg.length} schools need a plan before ${when(rs.max24End)}.`);
    const eta = rs.max24End - 6;
    const alerts: MapAlert[] = risk === "low" ? [] : [
      ...[...h.lost, ...h.deg].slice(0, 4).map((x, i) => ({ id: `facilities-h${i}`, agent: "facilities", lon: x.at[0], lat: x.at[1], severity: (x.access === "lost" ? "severe" : "high") as Severity, title: `Hospital access ${x.access} · ${x.name}`, detail: x.why || "Closed roads cut the route.", at: eta, when: when(eta) })),
      ...[...s.lost, ...s.deg].slice(0, 3).map((x, i) => ({ id: `facilities-s${i}`, agent: "facilities", lon: x.at[0], lat: x.at[1], severity: (x.access === "lost" ? "high" : "moderate") as Severity, title: `School access ${x.access} · ${x.name}`, detail: x.why || "Closed roads cut the route.", at: eta, when: when(eta) })),
    ];
    return {
      headline: risk === "low" ? "All facilities stay reachable." : `${h.lost.length + h.deg.length} hospitals and ${s.lost.length + s.deg.length} schools at risk; ${os.length} open spaces usable for shelter.`,
      risk: risk === "low" ? "low" : h.lost.length ? risk : "moderate", alerts, caveats: [MODELLED],
      facts: { hospitals: O.hospitals.length, hospitalsLost: h.lost.length, hospitalsDegraded: h.deg.length, schoolsLost: s.lost.length, schoolsDegraded: s.deg.length, responderBasesCutOff: r.lost.length, usableOpenSpaces: os.length, careHomes: g.careHomes.length },
    };
  },
};

const landslides: AgentDef = {
  id: "landslides", name: "Landslide agent", factor: "Landslides", sources: "BIPAD incidents 2021–2023 · rain threshold",
  blurb: "Slopes that failed before, and whether this rain can trigger them.",
  async run(ctx, step) {
    const H = load<{ incidents: { title: string; on: string; lon: number; lat: number; hazard: string; deaths: number }[] }>("real/kathmandu/incidents_history.json");
    const past = H.incidents.filter((i) => /landslide/i.test(i.hazard) && i.on < "2024-01-01");
    await step("read", `Loading verified BIPAD incidents: ${past.length} landslides in 2021–2023 (2024 withheld so the check can't cheat).`);
    const hot: { at: Pt; n: number; deaths: number }[] = [];
    for (const i of past) {
      const h = hot.find((x) => km(x.at, [i.lon, i.lat]) < 1.2);
      if (h) { h.n++; h.deaths += i.deaths; } else hot.push({ at: [i.lon, i.lat], n: 1, deaths: i.deaths });
    }
    hot.sort((a, b) => b.n - a.n);
    await step("calc", `${hot.length} past-failure clusters; ${hot.filter((h) => h.n >= 2).length} have failed more than once.`);
    const rs = rainStats(ctx), T = 100;
    const over = rs.stations.filter((s) => s.max24 >= T);
    await step("calc", `Trigger check: ${over.length} gauges exceed ${T} mm in 24 h (rule-of-thumb threshold, an assumption).`);
    const risk: Risk = over.length >= 3 ? "high" : over.length ? "moderate" : rs.max24 >= 60 ? "moderate" : "low";
    await step("found", risk === "low" ? "Rain stays under the trigger threshold." : `Hillside clusters near ${hot.slice(0, 2).map((h) => nearestPlace(h.at)).join(" and ")} are the first to watch.`);
    const alerts: MapAlert[] = risk === "low" ? [] : hot.slice(0, 4).map((h, i) => ({
      id: `landslides-${i}`, agent: "landslides", lon: h.at[0], lat: h.at[1], severity: risk === "high" && h.n >= 2 ? "high" : "moderate",
      title: `Landslide-prone slope · ${nearestPlace(h.at)}`, detail: `${h.n} landslide${h.n > 1 ? "s" : ""} here in 2021–2023${h.deaths ? `, ${h.deaths} deaths` : ""}.`, at: rs.max24End, when: when(rs.max24End),
    }));
    return {
      headline: risk === "low" ? "Low landslide risk: rain under trigger levels." : `${over.length} gauges over ${T} mm/24 h; ${Math.min(4, hot.length)} known slopes at risk.`,
      risk, alerts, caveats: ["Threshold is a rule of thumb, not a calibrated model.", "Past failures mark susceptibility; they don't predict exact sites."],
      facts: { pastLandslides: past.length, clusters: hot.length, repeatClusters: hot.filter((h) => h.n >= 2).length, gaugesOverThreshold: over.length, thresholdMm24h: T },
    };
  },
};

export const AGENTS: AgentDef[] = [weather, rivers, terrain, satellite, roads, cellular, power, social, facilities, landslides];
export const AGENT_BY_ID = new Map(AGENTS.map((a) => [a.id, a]));

/** Resources the report can allocate. Responder bases, army, airports and open spaces are real places; depot stock is simulated. */
export function resourcePack() {
  const O = ops();
  const byType = new Map<string, number>();
  for (const r of O.responders) byType.set(r.type || "Other", (byType.get(r.type || "Other") ?? 0) + 1);
  const food = load<{ depots: { name: string; packs: number }[] }>("real/kathmandu/google_food.json");
  return {
    responderBases: Object.fromEntries(byType),
    armySites: O.army.map((a) => a.name),
    airports: O.airports.map((a) => a.name),
    usableOpenSpaces: O.openSpaces.filter((o) => o.access === "ok").length,
    foodDepotsSimulated: food.depots.map((d) => `${d.name}: ${d.packs} packs`),
    officialAlertsActive: O.alerts.length,
  };
}
