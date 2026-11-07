import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { analyzeCascade, DEFAULT_PARAMS, type RealArea } from "../../packages/analysis/cascade.ts";
import { FLOOD_HAZARDS, impactEvents, valleyRainIndex, type Gauges, type LabelIncident } from "../../packages/analysis/detect.ts";
import { alertLevel, compareExposure, isMajorHospital, predictedArea, stageToHandM, steepRoads, type AlertLevel, type Terrain } from "../../packages/analysis/forward.ts";
import { buildWardDays, estimateWardPopulation, FEATURE_SETS, fitLogistic, labelRows, predict, type Model, type WardDays, type WardInfo } from "../../packages/analysis/risk.ts";
import type { AgentEvent } from "../../packages/shared/events.ts";
import { HttpError } from "./common.ts";
import { KTM_DIR } from "./hindcast.ts";

const FILES = ["gauges", "wards", "terrain", "incidents_history", "network", "places"];
const OUTLET_RIVER_ID = 4; // Bagmati at Khokana: the valley outlet
const STEEP_DEG = 30;      // assumption: ground this steep beside a road counts as landslide-exposed

const quantile = (a: number[], q: number) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]!; };

export type WardOutput = {
  id: number; name: string; lon: number; lat: number; population: number; floodRisk: number; landslideRisk: number; alert: AlertLevel;
  roadKmExposed: number; steepRoadKm: number; placesCutOffWorstCase: number;
};

type YearModels = { flood: Model; slide: Model; authorityCut: number; publicCut: number; trainRows: number; floodPositives: number; slidePositives: number; incidents: number };

export class PipelineService {
  gauges: Gauges; incidents: LabelIncident[]; terrain: Terrain; area: RealArea; days: WardDays;
  /** Keyed on the incident list, so swapping labels can never reuse a model fitted on the old ones. */
  private models = new WeakMap<LabelIncident[], Map<number, YearModels>>();
  private dir: string;

  constructor(dir = KTM_DIR) {
    this.dir = dir;
    const read = (f: string) => JSON.parse(readFileSync(`${dir}${f}.json`, "utf8"));
    this.gauges = read("gauges");
    this.incidents = read("incidents_history").incidents;
    this.terrain = read("terrain");
    const net = read("network"), pl = read("places");
    this.area = {
      nodes: net.nodes, places: pl.places, hospitals: pl.hospitals,
      edges: net.edges.map((e: any[]) => ({ u: e[0], v: e[1], minutes: e[2], lengthM: e[3], cls: e[4], bridge: !!e[5], floodedShare: e[6], name: e[7], osmWayId: e[8], mid: e[9], distFloodM: e[10], via: e[11] })),
    };
    const terrainById = new Map(this.terrain.wards.map((w) => [w.id, w]));
    const wards = estimateWardPopulation((read("wards").wards as WardInfo[]).map((w) => ({ ...w, ...terrainById.get(w.id)! })));
    const years = [...new Set(Object.values(this.gauges.rain).flatMap((s) => Object.keys(s.mm).map(Number)))].sort();
    this.days = buildWardDays(this.gauges, wards, years);
  }

  static available(dir = KTM_DIR) { return FILES.every((f) => existsSync(`${dir}${f}.json`)); }

  /** Dates a run can use, past impact events to jump to, and the stored evaluation. */
  meta() {
    const first = Math.min(...this.days.rows.map((r) => r.year));
    const dates = [...new Set(this.days.rows.filter((r) => r.year > first).map((r) => r.date))].sort();
    const usable = new Set(dates);
    const evalPath = `${this.dir}pipeline_eval.json`;
    const ev = existsSync(evalPath) ? JSON.parse(readFileSync(evalPath, "utf8")) : null;
    return {
      available: true, dates, wards: this.days.wards.length,
      events: impactEvents(this.incidents, 3).filter((e) => usable.has(e.first)).map((e) => ({ date: e.first, incidents: e.incidents })),
      evaluation: ev && { detector: [...ev.detector.primary, ...ev.detector.rainSweep], eventCount: ev.detector.impactEvents.length, wardModel: ev.wardModel, spatial: ev.spatial, forward2024: ev.forward2024 },
    };
  }

  /** Approximate ward areas for the map. */
  geo() { return JSON.parse(readFileSync(`${this.dir}ward_areas.geojson`, "utf8")); }

  /** Hourly outlet river level and median valley rain around a date, for charts. Null means no reading. */
  series(date: string, days = 3) {
    const year = date.slice(0, 4), start = Date.parse(`${year}-${this.gauges.season[0]}T00:00:00Z`);
    const river = this.gauges.river.find((r) => r.id === OUTLET_RIVER_ID);
    const stage = river?.stage[year] ?? [], rain = valleyRainIndex(this.gauges, Number(year), 1);
    const h0 = Math.round((Date.parse(`${date}T00:00:00Z`) - start) / 3600000);
    const hours = [];
    for (let h = Math.max(0, h0 - days * 24); h < Math.min(Math.max(stage.length, rain.length), h0 + (days + 1) * 24); h++) {
      hours.push({ t: new Date(start + h * 3600000).toISOString().slice(0, 13), stage: stage[h] ?? null, rain: rain[h] ?? null });
    }
    return { station: river?.title ?? null, warningLevel: river?.warningLevel ?? null, dangerLevel: river?.dangerLevel ?? null, hours };
  }

  /** Models for a year, fitted only on earlier years. */
  private modelsFor(year: number): YearModels {
    let byYear = this.models.get(this.incidents);
    if (!byYear) this.models.set(this.incidents, (byYear = new Map()));
    const hit = byYear.get(year);
    if (hit) return hit;
    const train = this.days.rows.flatMap((r, i) => (r.year < year ? [i] : []));
    if (!train.length) throw new HttpError(422, `No earlier years to train on for ${year}. A model may not learn from the year it is scoring.`);
    const prior = this.incidents.filter((i) => Number(i.on.slice(0, 4)) < year);
    const yFlood = labelRows(this.days, prior, FLOOD_HAZARDS), ySlide = labelRows(this.days, prior, ["Landslide"]);
    const sum = (y: Uint8Array) => train.reduce((a, i) => a + y[i]!, 0);
    if (!sum(yFlood)) throw new HttpError(422, `No flood incidents before ${year} in the usable data, so there is nothing to learn from.`);
    const flood = fitLogistic(this.days, yFlood, train, FEATURE_SETS.full), slide = fitLogistic(this.days, ySlide, train, FEATURE_SETS.full);
    const scores = train.map((i) => predict(flood, this.days, i));
    const m = { flood, slide, authorityCut: quantile(scores, 0.99), publicCut: quantile(scores, 0.999), trainRows: train.length, floodPositives: sum(yFlood), slidePositives: sum(ySlide), incidents: prior.length };
    byYear.set(year, m);
    return m;
  }

  /** The hourly river readings for one local day, and whether the outlet reached its official levels. */
  riverStatus(date: string) {
    const s = this.gauges.river.find((r) => r.id === OUTLET_RIVER_ID);
    const year = date.slice(0, 4), series = s?.stage[year];
    if (!s || !series) return null;
    const h0 = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${year}-${this.gauges.season[0]}T00:00:00Z`)) / 3600000);
    const readings = series.slice(Math.max(0, h0), h0 + 24).filter((x): x is number => x !== null);
    if (!readings.length) return { station: s.title, peak: null, warningLevel: s.warningLevel, dangerLevel: s.dangerLevel, aboveDanger: false };
    const peak = Math.max(...readings);
    return { station: s.title, peak, warningLevel: s.warningLevel, dangerLevel: s.dangerLevel, aboveDanger: peak >= s.dangerLevel };
  }

  /** Runs every stage for one day, using data through the end of that day and models trained only on earlier years. */
  run(date: string, onEvent?: (e: AgentEvent) => void) {
    const year = Number(date.slice(0, 4));
    const today = this.days.rows.flatMap((r, i) => (r.date === date ? [i] : []));
    if (!today.length) throw new HttpError(404, `No complete rain data for ${date}. Monsoon dates from 2021 onward are available, subject to gauge gaps.`);
    const models = this.modelsFor(year);

    const runId = `PIPE-${randomUUID().slice(0, 8)}`;
    const events: AgentEvent[] = [];
    const emit = (agent: AgentEvent["agent"], tool: string, inputs: unknown, summary: string, evidenceIds: string[] = []) => {
      const e: AgentEvent = { id: `${runId}-${events.length + 1}`, ts: new Date().toISOString(), runId, agent, mode: "rule-based", tool, inputs, summary, evidenceIds };
      events.push(e); onEvent?.(e);
    };
    emit("Coordinator", "assertTemporalSeparation", { date, trainYears: `before ${year}` }, `Models train on ${models.trainRows} ward-days and ${models.incidents} incidents from before ${year}. Incidents on or after the run date are withheld until verification.`);

    const river = this.riverStatus(date);
    const handM = river?.peak == null ? null : stageToHandM(river.peak, river.dangerLevel, this.terrain.handThresholdsM);
    emit("Hazard Agent", "readGauges", { station: river?.station ?? "none" }, river?.peak == null
      ? "No outlet river reading for this day, so no river flood map is produced."
      : `${river.station} peaked at ${river.peak.toFixed(2)} m (danger ${river.dangerLevel} m). ${handM === null ? "Below danger: no river flood predicted." : `Mapping terrain up to ${handM} m above drainage.`}`);

    const { flood: mFlood, slide: mSlide, authorityCut, publicCut } = models;

    const hazard = handM === null ? null : predictedArea(this.area, this.terrain, handM);
    const cascade = hazard ? analyzeCascade({ ...hazard, hospitals: hazard.hospitals.filter((h) => isMajorHospital(h.name)) }, DEFAULT_PARAMS) : null;
    if (cascade) emit("Access Agent", "analyzeCascade", { handM, hospitals: "major only" }, `Worst-case screen, not a closure prediction: ${cascade.counts.closedEdges} road segments exposed, ${cascade.counts.strandedEdges} dry segments that could be cut off, ${cascade.counts.cascadeIsolated} dry places that could lose hospital access, ${cascade.counts.cascadeDegraded} with degraded access.`);

    const atRisk = new Set(cascade?.closedEdges ?? []), steep = new Set(steepRoads(this.terrain, STEEP_DEG));
    const roadKm = new Float64Array(this.days.wards.length), steepKm = new Float64Array(this.days.wards.length);
    this.area.edges.forEach((e, i) => {
      const w = this.terrain.edges.ward[i]!;
      if (atRisk.has(i)) roadKm[w]! += e.lengthM / 1000;
      if (steep.has(i)) steepKm[w]! += e.lengthM / 1000;
    });
    const cutOff = new Map<number, number>();
    if (cascade) for (const p of cascade.places) if (p.status === "cascade-isolated" || p.status === "cascade-degraded") {
      const pl = this.area.places[p.index]!;
      let best = 0, bd = Infinity;
      this.days.wards.forEach((w, k) => { const d = (w.lon - pl.lon) ** 2 + (w.lat - pl.lat) ** 2; if (d < bd) { bd = d; best = k; } });
      cutOff.set(best, (cutOff.get(best) ?? 0) + 1);
    }

    const wards: WardOutput[] = today.map((i) => {
      const k = this.days.rows[i]!.ward, w = this.days.wards[k]!, floodRisk = predict(mFlood, this.days, i);
      return {
        id: w.id, name: w.name, lon: w.lon, lat: w.lat, population: Math.round(w.pop), floodRisk, landslideRisk: predict(mSlide, this.days, i),
        alert: alertLevel(floodRisk, authorityCut, publicCut, river?.aboveDanger ?? false),
        roadKmExposed: Math.round(roadKm[k]! * 10) / 10, steepRoadKm: Math.round(steepKm[k]! * 10) / 10, placesCutOffWorstCase: cutOff.get(k) ?? 0,
      };
    }).sort((a, b) => b.floodRisk - a.floodRisk);
    const count = (a: AlertLevel) => wards.filter((w) => w.alert === a).length;
    emit("Coordinator", "rankWards", { authorityCut, publicCut }, `${count("authority")} wards at authority level, ${count("public-draft")} with a public alert draft awaiting human approval. Nothing is sent.`);

    const actual = this.incidents.filter((i) => i.on === date);
    const flagged = new Set(wards.filter((w) => w.alert !== "none").map((w) => w.id));
    const reported = actual.filter((i) => FLOOD_HAZARDS.includes(i.hazard));
    const caught = reported.filter((i) => i.wards.some((id) => flagged.has(id))).length;
    emit("Verification Agent", "compareToIncidents", { date }, `Checked after prediction: ${reported.length} flood-family incidents reported that day, ${caught} in flagged wards.`);

    const observed = this.area.edges.map((e) => e.floodedShare > 0);
    return {
      runId, date, river, handM, wards, events, series: this.series(date),
      training: { rows: models.trainRows, floodIncidents: models.floodPositives, landslideIncidents: models.slidePositives },
      incidents: actual.map((i) => ({ id: i.id, title: i.title ?? i.hazard, hazard: i.hazard, lon: i.lon, lat: i.lat, deaths: i.deaths, families: i.families })),
      cuts: { authority: authorityCut, public: publicCut },
      // Worst case on purpose: HAND ranks vulnerable roads well but over-predicts as a yes/no map, so these are not closure predictions.
      roadScreen: cascade ? { basis: "worst-case screen, not a closure prediction", counts: cascade.counts, exposedEdges: cascade.closedEdges, cutOffEdges: cascade.strandedEdges } : null,
      exposureVsUnosat: hazard ? compareExposure(hazard.edges.map((e) => e.floodedShare >= DEFAULT_PARAMS.closeShare), observed) : null,
      verification: { reported: reported.length, inFlaggedWards: caught, allIncidents: actual.length },
      notes: ["Risk is the modelled chance of a reported incident, not of impact.", "The road screen is a worst case that over-predicts heavily. No road-closure labels exist yet, so closures are not predicted.", "Public alerts are drafts. A person must approve them, and this system sends nothing."],
    };
  }
}
