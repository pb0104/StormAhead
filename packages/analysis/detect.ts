/**
 * Gauge detector: turns hourly river and rain readings into alert episodes, then scores them over whole monsoons.
 * Scoring over full seasons is the point: it measures false alarms, which a single-event hindcast cannot.
 * Hours are local Nepal time, indexed from the season start; null means no reading, never zero.
 */
export type RainStation = { title: string; lon: number; lat: number; elevation?: number; mm: Record<string, (number | null)[]> };
export type RiverStation = { id: number; title: string; lon: number; lat: number; warningLevel: number; dangerLevel: number; stage: Record<string, (number | null)[]> };
export type Gauges = { season: [string, string]; rain: RainStation[]; river: RiverStation[] };
export type LabelIncident = { id: number; on: string; lon: number; lat: number; wards: number[]; hazard: string; deaths: number; families: number; title?: string };

export const FLOOD_HAZARDS = ["Flood", "Inundation", "Heavy Rainfall"];

export const hourToIso = (year: number, seasonStart: string, h: number) => new Date(Date.parse(`${year}-${seasonStart}T00:00:00Z`) + h * 3600000).toISOString().slice(0, 16);
export const hourToDate = (year: number, seasonStart: string, h: number) => hourToIso(year, seasonStart, h).slice(0, 10);

/** Rolling sum over the trailing `w` hours. Null unless at least `minCover` of the window reported. */
export function rollingSum(v: (number | null)[], w: number, minCover = 0.75): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  let sum = 0, n = 0;
  for (let i = 0; i < v.length; i++) {
    const add = v[i]; if (add !== null && add !== undefined) { sum += add; n++; }
    if (i >= w) { const rem = v[i - w]; if (rem !== null && rem !== undefined) { sum -= rem; n--; } }
    if (i >= w - 1 && n >= w * minCover) out[i] = Math.max(sum, 0);
  }
  return out;
}

const median = (a: number[]) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

/** Valley rain index: median across stations of each station's trailing total. Null when fewer than `minStations` report. */
export function valleyRainIndex(g: Gauges, year: number, windowH: number, minStations = 3): (number | null)[] {
  const rolled = g.rain.map((s) => s.mm[year]).filter((x): x is (number | null)[] => !!x).map((x) => rollingSum(x, windowH));
  if (!rolled.length) return [];
  const len = Math.max(...rolled.map((r) => r.length));
  return Array.from({ length: len }, (_, i) => {
    const vals = rolled.map((r) => r[i]).filter((x): x is number => x !== null && x !== undefined);
    return vals.length >= minStations ? median(vals) : null;
  });
}

export type Episode = { year: number; startHour: number; endHour: number; start: string; end: string; peak: number };

/** Hours at or above `threshold`, merged into episodes when separated by fewer than `mergeGapH` hours. */
export function episodes(series: (number | null)[], threshold: number, year: number, seasonStart: string, mergeGapH = 24): Episode[] {
  const out: Episode[] = [];
  series.forEach((x, h) => {
    if (x === null || x === undefined || x < threshold) return;
    const last = out[out.length - 1];
    if (last && h - last.endHour <= mergeGapH) { last.endHour = h; last.peak = Math.max(last.peak, x); last.end = hourToIso(year, seasonStart, h); }
    else out.push({ year, startHour: h, endHour: h, start: hourToIso(year, seasonStart, h), end: hourToIso(year, seasonStart, h), peak: x });
  });
  return out;
}

export type ImpactEvent = { year: number; first: string; last: string; incidents: number };

/** Runs of consecutive days with at least `minPerDay` flood-family incidents in the valley. Built only from labels. */
export function impactEvents(incidents: LabelIncident[], minPerDay: number): ImpactEvent[] {
  const byDay = new Map<string, number>();
  for (const i of incidents) if (FLOOD_HAZARDS.includes(i.hazard)) byDay.set(i.on, (byDay.get(i.on) ?? 0) + 1);
  const days = [...byDay].filter(([, n]) => n >= minPerDay).map(([d]) => d).sort();
  const out: ImpactEvent[] = [];
  for (const d of days) {
    const last = out[out.length - 1];
    if (last && Date.parse(d) - Date.parse(last.last) <= 86400000) { last.last = d; last.incidents += byDay.get(d)!; }
    else out.push({ year: Number(d.slice(0, 4)), first: d, last: d, incidents: byDay.get(d)! });
  }
  return out;
}

export type DetectorScore = {
  rule: string; episodes: number; hits: number; falseAlarms: number; events: number; detected: number; missed: number; unobserved: number;
  precision: number | null; recall: number | null; falseAlarmsPerSeason: number; seasons: number;
};

/**
 * An episode is a hit when an impact event overlaps it, allowing one day either side because incident dates are day-level.
 * An event with no readings around it is "unobserved", not missed: a gauge outage must not look like a detector failure.
 */
export function scoreDetector(rule: string, eps: Episode[], events: ImpactEvent[], seriesByYear: Map<number, (number | null)[]>, seasonStart: string): DetectorScore {
  const day = 86400000;
  const overlap = (e: Episode, v: ImpactEvent) => Date.parse(e.start.slice(0, 10)) - day <= Date.parse(v.last) && Date.parse(e.end.slice(0, 10)) + day >= Date.parse(v.first);
  const observed = (v: ImpactEvent) => {
    const s = seriesByYear.get(v.year); if (!s) return false;
    const h0 = (Date.parse(v.first) - day - Date.parse(`${v.year}-${seasonStart}T00:00:00Z`)) / 3600000;
    const h1 = h0 + (Date.parse(v.last) - Date.parse(v.first)) / 3600000 + 72;
    for (let h = Math.max(0, h0); h < Math.min(s.length, h1); h++) if (s[h] !== null && s[h] !== undefined) return true;
    return false;
  };
  const inScope = events.filter((v) => seriesByYear.has(v.year));
  const hits = eps.filter((e) => inScope.some((v) => overlap(e, v))).length;
  const detected = inScope.filter((v) => eps.some((e) => overlap(e, v))).length;
  const unobserved = inScope.filter((v) => !eps.some((e) => overlap(e, v)) && !observed(v)).length;
  const missed = inScope.length - detected - unobserved;
  const seasons = seriesByYear.size;
  return {
    rule, episodes: eps.length, hits, falseAlarms: eps.length - hits, events: inScope.length, detected, missed, unobserved,
    precision: eps.length ? hits / eps.length : null, recall: detected + missed ? detected / (detected + missed) : null,
    falseAlarmsPerSeason: seasons ? (eps.length - hits) / seasons : 0, seasons,
  };
}
