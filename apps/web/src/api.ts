import type { AgentEvent } from "../../../packages/shared/events.ts";
import type { AssessmentResult, AssetsSnapshot, AtmosphereSnapshot, SceneSnapshot, WeatherSeed } from "../../../packages/ports/index.ts";
import type { Closure } from "../../../packages/analysis/replay.ts";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: init?.body ? { "Content-Type": "application/json" } : {} });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as any).error ?? `HTTP ${r.status}`);
  return body as T;
}
const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export type HindcastRun = {
  runId: string; params: { closeShare: number; bridgeClosesOnAnyContact: boolean; degradeMinutes: number; degradeRatio: number };
  result: { counts: Record<string, number>; closedEdges: number[]; exposedEdges: number[]; strandedEdges: number[]; placeStatus: string[]; placeT0: (number | null)[]; placeT1: (number | null)[]; hospitals: { index: number; inFlood: boolean; disconnected: boolean }[] };
  score: { options: { radiusM: number; directBufferM: number; primaryHazards: string[]; permutations: number }; evaluated: number; inFlood: number; outsideFlood: number; outsideCovered: number; outsideRecall: number | null;
    randomBaseline: { meanCovered: number; p: number }; proximityBaseline: { covered: number }; flagged: { places: number; edges: number };
    incidents: { id: number; title: string; hazard: string; distFloodM: number; zone: string; coveredByCascade: boolean | null }[] };
  sensitivity: { closeShare: number; closedEdges: number; cascadeIsolated: number; cascadeDegraded: number; strandedEdges: number; outsideCovered: number; outsideFlood: number; randomMean: number; p: number; proximity: number }[];
  radiusSensitivity: { radiusM: number; outsideCovered: number; outsideFlood: number; randomMean: number; p: number; proximity: number }[];
  landslideCheck: { evaluated: number; inFlood: number; outsideFlood: number; outsideCovered: number; randomMean: number; p: number; proximity: number };
  events: AgentEvent[];
};
export type HindcastMeta = { available: boolean; provenance?: any; incidents?: any; evaluationIncidents?: number; defaults?: any };
export type HindcastGeo = { roads: any; flood: any; places: { n: string; lon: number; lat: number }[]; hospitals: { n: string; lon: number; lat: number; inFlood: boolean }[];
  incidents: { id: number; title: string; lon: number; lat: number; hazard: string; floodRelated: boolean; hasImpact: boolean; distFloodM: number; on: string; loss: Record<string, number> }[] };
export const hindcast = {
  meta: () => j<HindcastMeta>("/api/hindcast/meta"),
  geo: () => j<HindcastGeo>("/api/hindcast/geo"),
  run: (p: Record<string, unknown>) => j<HindcastRun>("/api/hindcast/run", send("POST", p)),
};

export type HeleneClosure = Closure & { edge: number | null; match: "ref" | "nearest" | "unmatched"; snapDistM: number | null };
export type HeleneMeta = { available: boolean; provenance?: any; counties?: string[]; records?: number; byMatch?: Record<string, number>; byCondition?: Record<string, number>; replayRange?: string[]; caveats?: string[] };
export type HeleneRoads = { nodes: [number, number][]; edges: [number, number, number, number, string, number, string | null, string | null, number, [number, number][] | null][] };
export const helene = {
  meta: () => j<HeleneMeta>("/api/helene/meta"),
  roads: () => j<HeleneRoads>("/api/helene/roads"),
  closures: () => j<{ closures: HeleneClosure[] }>("/api/helene/closures"),
};

export const ops = {
  scene: () => j<SceneSnapshot>("/api/scene"),
  weatherSeed: () => j<WeatherSeed>("/api/weather/seed"),
  atmosphere: (refresh = false) => j<AtmosphereSnapshot>(`/api/weather/atmosphere${refresh ? "?refresh=1" : ""}`),
  assessment: (rainIn: number, stage: number) => j<AssessmentResult>(`/api/assessment?rainIn=${rainIn}&stage=${stage}`),
  assets: (refresh = false) => j<AssetsSnapshot>(`/api/assets${refresh ? "?refresh=1" : ""}`),
};

export const TILE = {
  esri: (z: number, y: number, x: number) => `/api/tiles/esri/${z}/${y}/${x}`,
  terrarium: (z: number, x: number, y: number) => `/api/tiles/terrarium/${z}/${x}/${y}.png`,
  cesiumProxy: (upstreamUrl: string) => `/api/tiles/cesium?u=${encodeURIComponent(upstreamUrl)}`,
};

export type AlertLevel = "none" | "authority" | "public-draft";
export type WardOut = { id: number; name: string; lon: number; lat: number; population: number; floodRisk: number; landslideRisk: number; alert: AlertLevel; roadKmExposed: number; steepRoadKm: number; placesCutOffWorstCase: number };
export type SeriesHour = { t: string; stage: number | null; rain: number | null };
export type DetectorRow = { rule: string; events: number; detected: number; missed: number; unobserved: number; falseAlarmsPerSeason: number };
export type ModelSet = { set: string; pooled: { ap: number | null; auc: number | null; recallTop1pct: number | null; positives: number } };
export type PipelineMeta = {
  available: boolean; dates: string[]; wards: number; events: { date: string; incidents: number }[];
  evaluation: null | { detector: DetectorRow[]; eventCount: number; wardModel: { horizon: string; targets: { target: string; sets: ModelSet[] }[] }[]; spatial: { target: string; sets: { set: string; incidentWeightedAuc: number }[] }[] };
};
export type PipelineRun = {
  runId: string; date: string; handM: number | null; wards: WardOut[]; events: AgentEvent[]; notes: string[];
  river: { station: string; peak: number | null; warningLevel: number; dangerLevel: number; aboveDanger: boolean } | null;
  series: { station: string | null; warningLevel: number | null; dangerLevel: number | null; hours: SeriesHour[] };
  training: { rows: number; floodIncidents: number; landslideIncidents: number };
  incidents: { id: number; title: string; hazard: string; lon: number; lat: number; deaths: number; families: number }[];
  roadScreen: null | { basis: string; counts: Record<string, number>; exposedEdges: number[]; cutOffEdges: number[] };
  verification: { reported: number; inFlaggedWards: number; allIncidents: number };
};
export const pipeline = {
  meta: () => j<PipelineMeta>("/api/pipeline/meta"),
  geo: () => j<any>("/api/pipeline/geo"),
  run: (date: string) => j<PipelineRun>("/api/pipeline/run", send("POST", { date })),
};
