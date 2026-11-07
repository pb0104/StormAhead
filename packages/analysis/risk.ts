/**
 * Ward-by-day risk model. Each row is one ward on one day; the label is "a verified incident of this hazard was reported".
 * Scoring ranks ward-days and compares against baselines, because a fixed-radius match cannot show skill in a dense valley.
 * Absence of a report is not absence of impact, so these are reported-incident probabilities, not impact probabilities.
 */
import { rollingSum, type Gauges, type LabelIncident } from "./detect.ts";

export type WardInfo = { id: number; name: string; municipality: number; municipalityPop2021: number | null; lon: number; lat: number };
export type WardTerrain = { id: number; elev: number; slopeMean: number; slopeP90: number; lowHandShare: number; roadKm: number };
export type WardRow = { year: number; date: string; ward: number; rainToday: number; rainPrior3: number };
export type WardDays = { wards: (WardInfo & WardTerrain & { pop: number })[]; rows: WardRow[]; droppedDays: number };

export const FEATURE_SETS = {
  /** Where people and roads are, with no weather: separates "this model sees rain" from "this model sees the city". */
  exposure: ["pop", "road"],
  terrain: ["lowHand", "slope", "pop", "road"],
  rain: ["rainToday", "rainPrior3"],
  full: ["rainToday", "rainPrior3", "lowHand", "slope", "pop", "road", "rainToday*lowHand", "rainToday*slope", "rainPrior3*slope"],
} as const;
export type FeatureSet = keyof typeof FEATURE_SETS;

const KX = 98600, KY = 110600;

/** Municipal census spread over its wards in proportion to road length: a rough proxy, since ward counts are not in this feed. */
export function estimateWardPopulation(wards: (WardInfo & WardTerrain)[]): (WardInfo & WardTerrain & { pop: number })[] {
  const km = new Map<number, number>();
  for (const w of wards) km.set(w.municipality, (km.get(w.municipality) ?? 0) + w.roadKm);
  return wards.map((w) => ({ ...w, pop: w.municipalityPop2021 && km.get(w.municipality) ? (w.municipalityPop2021 * w.roadKm) / km.get(w.municipality)! : 0 }));
}

/** Daily rain per ward by inverse-distance weighting of stations that reported at least 18 of 24 hours. */
export function buildWardDays(g: Gauges, wards: (WardInfo & WardTerrain & { pop: number })[], years: number[], lagDays = 0): WardDays {
  const seasonStart = g.season[0];
  const rows: WardRow[] = [];
  let droppedDays = 0;
  for (const year of years) {
    const stations = g.rain.filter((s) => s.mm[year]);
    if (stations.length < 3) continue;
    const nDays = Math.floor(Math.max(...stations.map((s) => s.mm[year]!.length)) / 24);
    const daily = stations.map((s) => Array.from({ length: nDays }, (_, d) => {
      const hrs = s.mm[year]!.slice(d * 24, d * 24 + 24).filter((x): x is number => x !== null && x !== undefined);
      return hrs.length >= 18 ? hrs.reduce((a, b) => a + b, 0) * (24 / hrs.length) : null;
    }));
    const weights = wards.map((w) => stations.map((s) => 1 / (Math.hypot((s.lon - w.lon) * KX, (s.lat - w.lat) * KY) ** 2 + 1e6)));
    const rainAt = (wi: number, d: number): number | null => {
      if (d < 0) return null;
      let num = 0, den = 0, n = 0;
      daily.forEach((col, si) => { const v = col[d]; if (v !== null && v !== undefined) { num += v * weights[wi]![si]!; den += weights[wi]![si]!; n++; } });
      return n >= 3 ? num / den : null;
    };
    for (let d = 4 + lagDays; d < nDays; d++) {
      const date = new Date(Date.parse(`${year}-${seasonStart}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
      const dayRows: WardRow[] = [];
      for (let wi = 0; wi < wards.length; wi++) {
        const t = rainAt(wi, d - lagDays);
        const p = [1, 2, 3].map((k) => rainAt(wi, d - lagDays - k));
        if (t === null || p.some((x) => x === null)) { dayRows.length = 0; break; }
        dayRows.push({ year, date, ward: wi, rainToday: t, rainPrior3: p.reduce((a, b) => a! + b!, 0)! });
      }
      if (dayRows.length) rows.push(...dayRows); else droppedDays++;
    }
  }
  return { wards, rows, droppedDays };
}

/** The ward an incident belongs to: its own ward ID when in the valley, otherwise the nearest centroid. */
export function wardIndexOf(i: LabelIncident, wards: WardInfo[], byId: Map<number, number>): number {
  for (const id of i.wards) { const k = byId.get(id); if (k !== undefined) return k; }
  let best = 0, bd = Infinity;
  wards.forEach((w, k) => { const d = Math.hypot((w.lon - i.lon) * KX, (w.lat - i.lat) * KY); if (d < bd) { bd = d; best = k; } });
  return best;
}

export function labelRows(d: WardDays, incidents: LabelIncident[], hazards: string[]): Uint8Array {
  const byId = new Map(d.wards.map((w, k) => [w.id, k]));
  const hit = new Set(incidents.filter((i) => hazards.includes(i.hazard)).map((i) => `${i.on}|${wardIndexOf(i, d.wards, byId)}`));
  return Uint8Array.from(d.rows, (r) => (hit.has(`${r.date}|${r.ward}`) ? 1 : 0));
}

function featureRow(names: readonly string[], r: WardRow, w: WardDays["wards"][number]): number[] {
  const rainToday = Math.log1p(r.rainToday), rainPrior3 = Math.log1p(r.rainPrior3), lowHand = w.lowHandShare, slope = w.slopeP90 / 45;
  const pop = Math.log1p(w.pop), road = Math.log1p(w.roadKm);
  const v: Record<string, number> = { rainToday, rainPrior3, lowHand, slope, pop, road, "rainToday*lowHand": rainToday * lowHand, "rainToday*slope": rainToday * slope, "rainPrior3*slope": rainPrior3 * slope };
  return names.map((n) => v[n]!);
}

export type Model = { names: readonly string[]; mean: number[]; sd: number[]; beta: number[] };

function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r]![c]! / M[c]![c]!; for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!; }
  }
  return M.map((r, i) => r[n]! / r[i]!);
}

/** Ridge logistic regression by Newton steps: small, deterministic and inspectable, which suits a few hundred positives. */
export function fitLogistic(d: WardDays, y: Uint8Array, idx: number[], names: readonly string[], ridge = 1): Model {
  const p = names.length;
  const X = idx.map((i) => featureRow(names, d.rows[i]!, d.wards[d.rows[i]!.ward]!));
  const mean = Array.from({ length: p }, (_, j) => X.reduce((a, r) => a + r[j]!, 0) / X.length);
  const sd = mean.map((m, j) => Math.sqrt(X.reduce((a, r) => a + (r[j]! - m) ** 2, 0) / X.length) || 1);
  const Z = X.map((r) => [1, ...r.map((v, j) => (v - mean[j]!) / sd[j]!)]);
  const beta = new Array(p + 1).fill(0);
  const rate = idx.reduce((a, i) => a + y[i]!, 0) / idx.length;
  beta[0] = Math.log(Math.max(rate, 1e-6) / (1 - Math.max(rate, 1e-6)));
  for (let it = 0; it < 100; it++) {
    const H = Array.from({ length: p + 1 }, () => new Array(p + 1).fill(0)), g = new Array(p + 1).fill(0);
    Z.forEach((z, k) => {
      const mu = 1 / (1 + Math.exp(-z.reduce((a, v, j) => a + v * beta[j]!, 0))), w = Math.max(mu * (1 - mu), 1e-9), e = y[idx[k]!]! - mu;
      for (let a = 0; a <= p; a++) { g[a] += e * z[a]!; for (let b = a; b <= p; b++) H[a]![b]! += w * z[a]! * z[b]!; }
    });
    for (let a = 0; a <= p; a++) { for (let b = 0; b < a; b++) H[a]![b] = H[b]![a]!; if (a) { H[a]![a]! += ridge; g[a] -= ridge * beta[a]!; } }
    const step = solve(H, g);
    // Rare events often leave a group of rows with no positives, where a full Newton step overshoots and diverges. Cap the step.
    const biggest = Math.max(...step.map(Math.abs)), scale = biggest > 1 ? 1 / biggest : 1;
    step.forEach((s, j) => { beta[j] += s * scale; });
    if (biggest < 1e-6) break;
  }
  return { names, mean, sd, beta };
}

export function predict(m: Model, d: WardDays, i: number): number {
  const x = featureRow(m.names, d.rows[i]!, d.wards[d.rows[i]!.ward]!);
  let s = m.beta[0]!; x.forEach((v, j) => { s += m.beta[j + 1]! * ((v - m.mean[j]!) / m.sd[j]!); });
  return 1 / (1 + Math.exp(-s));
}

export type RankMetrics = { n: number; positives: number; baseRate: number; auc: number | null; averagePrecision: number | null; recallTop1pct: number | null; liftTop1pct: number | null };

export function rankMetrics(score: ArrayLike<number>, y: ArrayLike<number>): RankMetrics {
  const n = score.length, order = Array.from({ length: n }, (_, i) => i).sort((a, b) => score[b]! - score[a]!);
  let pos = 0; for (let i = 0; i < n; i++) pos += y[i]!;
  if (!pos || pos === n) return { n, positives: pos, baseRate: pos / n, auc: null, averagePrecision: null, recallTop1pct: null, liftTop1pct: null };
  let tp = 0, ap = 0, rankSum = 0, topHits = 0;
  const top = Math.max(1, Math.floor(n * 0.01));
  // Tied scores share their average rank, so ties (common for exposure-only baselines) neither help nor hurt.
  for (let s = 0; s < n;) {
    let e = s; while (e + 1 < n && score[order[e + 1]!] === score[order[s]!]) e++;
    let groupPos = 0; for (let k = s; k <= e; k++) groupPos += y[order[k]!]!;
    rankSum += groupPos * (n - (s + e) / 2);
    for (let k = s; k <= e; k++) { if (y[order[k]!]) { tp++; ap += tp / (k + 1); } if (k < top) topHits += groupPos / (e - s + 1); }
    s = e + 1;
  }
  const neg = n - pos;
  const auc = (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
  return { n, positives: pos, baseRate: pos / n, auc, averagePrecision: ap / pos, recallTop1pct: topHits / pos, liftTop1pct: topHits / top / (pos / n) };
}

export type HeldOut = { featureSet: FeatureSet; pooled: RankMetrics; byYear: { year: number; metrics: RankMetrics }[]; score: Float64Array };

/** Leave-one-year-out: each year is scored by a model that never saw it. */
export function leaveOneYearOut(d: WardDays, y: Uint8Array, set: FeatureSet): HeldOut {
  const names = FEATURE_SETS[set], years = [...new Set(d.rows.map((r) => r.year))].sort();
  const score = new Float64Array(d.rows.length);
  const byYear: HeldOut["byYear"] = [];
  for (const year of years) {
    const train: number[] = [], test: number[] = [];
    d.rows.forEach((r, i) => (r.year === year ? test : train).push(i));
    const m = fitLogistic(d, y, train, names);
    for (const i of test) score[i] = predict(m, d, i);
    byYear.push({ year, metrics: rankMetrics(test.map((i) => score[i]!), test.map((i) => y[i]!)) });
  }
  return { featureSet: set, pooled: rankMetrics(score, y), byYear, score };
}
