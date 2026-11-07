/**
 * Scores the forward pipeline and writes data/real/kathmandu/pipeline_eval.json. Run: npx tsx scripts/run_pipeline_eval.ts
 *
 * Declared BEFORE the first run, so results cannot reshape the test:
 *  - Gauge detector: official Khokana warning and danger levels are the primary rules (nothing tuned). Rain thresholds are a sweep,
 *    so they are exploratory. An impact event is a day with >= 3 flood-family incidents, or a run of such days.
 *  - Ward model: scored on held-out years. The flood model has skill only if "full" beats BOTH "exposure" and "rain" on pooled
 *    average precision. The same applies to landslides.
 *  - Negative control: fire has no physical link to rain. If adding rain clearly helps fire, the setup is finding artefacts.
 */
import { writeFileSync } from "node:fs";
import { PipelineService } from "../apps/api/pipeline.ts";
import { episodes, FLOOD_HAZARDS, hourToIso, impactEvents, scoreDetector, valleyRainIndex, type Episode } from "../packages/analysis/detect.ts";
import { compareExposure, predictedArea } from "../packages/analysis/forward.ts";
import { buildWardDays, labelRows, leaveOneYearOut, rankMetrics, FEATURE_SETS, fitLogistic, predict, type FeatureSet } from "../packages/analysis/risk.ts";

const OUT = "data/real/kathmandu/pipeline_eval.json";
const p = new PipelineService();
const g = p.gauges, ss = g.season[0];
const years = [...new Set(g.rain.flatMap((s) => Object.keys(s.mm).map(Number)))].sort();
const r3 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);

// ---- data audit ----
const audit = {
  years, wards: p.days.wards.length, wardDays: p.days.rows.length, droppedDays: p.days.droppedDays,
  daysByYear: Object.fromEntries(years.map((y) => [y, new Set(p.days.rows.filter((r) => r.year === y).map((r) => r.date)).size])),
  incidents: p.incidents.length, byHazard: Object.fromEntries(Object.entries(p.incidents.reduce<Record<string, number>>((a, i) => ((a[i.hazard] = (a[i.hazard] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1])),
  incidentsByYear: Object.fromEntries(years.map((y) => [y, p.incidents.filter((i) => i.on.startsWith(String(y))).length])),
  riverCoverage: g.river.map((s) => ({ title: s.title, warning: s.warningLevel, danger: s.dangerLevel, byYear: Object.fromEntries(Object.entries(s.stage).map(([y, v]) => [y, { hours: v.filter((x) => x !== null).length, of: v.length, max: Math.max(...v.filter((x): x is number => x !== null)) }])) })),
  rainStationsByYear: Object.fromEntries(years.map((y) => [y, g.rain.filter((s) => s.mm[y]?.some((x) => x !== null)).length])),
};

// ---- gauge detector over whole monsoons ----
const events = impactEvents(p.incidents, 3);
const eventsAny = impactEvents(p.incidents, 1);
const khokana = g.river.find((r) => r.id === 4)!;
const riverByYear = new Map(Object.entries(khokana.stage).map(([y, v]) => [Number(y), v]));
const riverRule = (level: number, name: string) => {
  const eps: Episode[] = [...riverByYear].flatMap(([y, v]) => episodes(v, level, y, ss));
  return { score: scoreDetector(name, eps, events, riverByYear, ss), episodes: eps };
};
const rain24 = new Map(years.map((y) => [y, valleyRainIndex(g, y, 24)]));
const rainRule = (mm: number) => {
  const eps: Episode[] = [...rain24].flatMap(([y, v]) => episodes(v, mm, y, ss));
  return { score: scoreDetector(`Valley rain >= ${mm} mm / 24 h (exploratory)`, eps, events, rain24, ss), episodes: eps };
};
const warn = riverRule(khokana.warningLevel, `Khokana >= warning ${khokana.warningLevel} m`);
const danger = riverRule(khokana.dangerLevel, `Khokana >= danger ${khokana.dangerLevel} m`);
const rainSweep = [40, 60, 80, 100, 130].map(rainRule);

// ---- Sept 2024 timeline ----
const start = Date.parse(`2024-${ss}T00:00:00Z`);
const firstAt = (v: (number | null)[] | undefined, t: number, from: string) => {
  if (!v) return null;
  const h0 = (Date.parse(from + "T00:00:00Z") - start) / 3600000;
  for (let h = h0; h < v.length; h++) if ((v[h] ?? -Infinity) >= t) return hourToIso(2024, ss, h);
  return null;
};
const s24 = khokana.stage["2024"];
const window24 = s24 ? s24.map((x, h) => [h, x] as const).filter(([h, x]) => { const d = hourToIso(2024, ss, h).slice(0, 10); return x !== null && d >= "2024-09-25" && d <= "2024-09-30"; }) : [];
const peak = window24.length ? window24.reduce((a, b) => (b[1]! > a[1]! ? b : a)) : null;
const r24 = rain24.get(2024);
const dangerAt = firstAt(s24, khokana.dangerLevel, "2024-09-25");
const hoursBefore = (t: string | null) => (t && dangerAt ? (Date.parse(dangerAt + ":00Z") - Date.parse(t + ":00Z")) / 3600000 : null);
const timeline = {
  warningAt: firstAt(s24, khokana.warningLevel, "2024-09-25"), dangerAt, peakM: peak ? r3(peak[1]) : null, peakAt: peak ? hourToIso(2024, ss, peak[0]) : null,
  rainTriggers: [40, 60, 80, 100].map((mm) => { const at = firstAt(r24, mm, "2024-09-25"); return { mm, at, hoursBeforeDanger: hoursBefore(at) }; }),
  maxValley24h: r24 ? r3(Math.max(...r24.slice((Date.parse("2024-09-25T00:00:00Z") - start) / 3600000, (Date.parse("2024-10-01T00:00:00Z") - start) / 3600000).filter((x): x is number => x !== null))) : null,
  firstIncidentDay: p.incidents.filter((i) => FLOOD_HAZARDS.includes(i.hazard) && i.on >= "2024-09-25" && i.on <= "2024-10-01").map((i) => i.on).sort()[0] ?? null,
};

// ---- ward model on held-out years ----
const SETS: FeatureSet[] = ["exposure", "terrain", "rain", "full"];
const round = (m: ReturnType<typeof rankMetrics>) => ({ positives: m.positives, baseRate: r3(m.baseRate === null ? null : m.baseRate * 1000), auc: r3(m.auc), ap: r3(m.averagePrecision), recallTop1pct: r3(m.recallTop1pct), liftTop1pct: r3(m.liftTop1pct) });
const targets: [string, string[]][] = [["flood", FLOOD_HAZARDS], ["landslide", ["Landslide"]], ["fire (negative control)", ["Fire"]]];
const lag1 = buildWardDays(g, p.days.wards, years, 1);
const wardModel = [{ name: "same day", d: p.days }, { name: "next day (rain only up to the previous day)", d: lag1 }].map(({ name, d }) => ({
  horizon: name,
  targets: targets.map(([t, hz]) => {
    const y = labelRows(d, p.incidents, hz);
    return { target: t, sets: SETS.map((s) => { const r = leaveOneYearOut(d, y, s); return { set: s, pooled: round(r.pooled), byYear: r.byYear.map((b) => ({ year: b.year, ...round(b.metrics) })) }; }) };
  }),
}));

// ---- added AFTER the first run, so diagnostic only: pooled AUC mostly rewards picking the right day. This asks, on days that had
// incidents, whether the model also ranks the right wards. A day-only signal scores 0.5 here.
const withinDay = (d: typeof p.days, y: Uint8Array, score: ArrayLike<number>) => {
  const byDay = new Map<string, number[]>();
  d.rows.forEach((r, i) => { const a = byDay.get(r.date); if (a) a.push(i); else byDay.set(r.date, [i]); });
  const aucs: { auc: number; n: number }[] = [];
  for (const idx of byDay.values()) {
    const m = rankMetrics(idx.map((i) => score[i]!), idx.map((i) => y[i]!));
    if (m.auc !== null) aucs.push({ auc: m.auc, n: m.positives });
  }
  const tot = aucs.reduce((a, b) => a + b.n, 0);
  return { days: aucs.length, incidentWeightedAuc: r3(aucs.reduce((a, b) => a + b.auc * b.n, 0) / tot) };
};
const spatial = targets.slice(0, 2).map(([t, hz]) => {
  const y = labelRows(p.days, p.incidents, hz);
  return { target: t, sets: SETS.map((s) => ({ set: s, ...withinDay(p.days, y, leaveOneYearOut(p.days, y, s).score) })) };
});

// ---- strict forward test: 2024 scored by a model trained only on earlier years ----
const yF = labelRows(p.days, p.incidents, FLOOD_HAZARDS);
const tr = p.days.rows.flatMap((r, i) => (r.year < 2024 ? [i] : [])), te = p.days.rows.flatMap((r, i) => (r.year === 2024 ? [i] : []));
const forward2024 = tr.length && te.length ? (() => { const m = fitLogistic(p.days, yF, tr, FEATURE_SETS.full); return { trainRows: tr.length, trainPositives: tr.reduce((a, i) => a + yF[i]!, 0), test: round(rankMetrics(te.map((i) => predict(m, p.days, i)), te.map((i) => yF[i]!))), coefficients: Object.fromEntries(m.names.map((n, j) => [n, r3(m.beta[j + 1]!)])) }; })() : null;

// ---- terrain vs the observed flood map ----
const obs = p.area.edges.map((e) => e.floodedShare > 0);
const handSweep = p.terrain.handThresholdsM.map((h) => ({ handM: h, ...compareExposure(predictedArea(p.area, p.terrain, h).edges.map((e) => e.floodedShare >= 0.3), obs) }));

// ---- end-to-end event days ----
const runs = ["2024-09-26", "2024-09-27", "2024-09-28", "2024-09-29"].flatMap((date) => {
  try {
    const r = p.run(date);
    return [{ date, river: r.river, handM: r.handM, cuts: r.cuts, roadScreen: r.roadScreen?.counts ?? null, exposureVsUnosat: r.exposureVsUnosat, verification: r.verification, alerts: { authority: r.wards.filter((w) => w.alert === "authority").length, publicDraft: r.wards.filter((w) => w.alert === "public-draft").length }, topWards: r.wards.slice(0, 8).map((w) => ({ name: w.name, flood: Math.round(w.floodRisk * 1e5) / 1e5, slide: Math.round(w.landslideRisk * 1e5) / 1e5, alert: w.alert, roadKm: w.roadKmExposed })) }];
  } catch (e: any) { return [{ date, error: e.message }]; }
});

const result = { audit, detector: { impactEvents: events, impactEventsAnyIncident: eventsAny.length, primary: [warn.score, danger.score], dangerEpisodes: danger.episodes, rainSweep: rainSweep.map((x) => x.score) }, timeline, wardModel, spatial, forward2024, handSweep, runs };
writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
