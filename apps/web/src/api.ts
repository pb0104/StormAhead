import type { AgentEvent } from "../../../packages/shared/events.ts";

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
export type AgentScore = {
  agent: string; what: string; flaggedWards: number;
  confusion: { tp: number; fp: number; fn: number; tn: number; precision: number | null; recall: number | null; f1: number | null; iou: number | null };
  randomBaseline: { meanTp: number; meanF1: number; p: number };
  proximityBaseline: { tp: number; f1: number | null };
};
export type Scorecard = {
  wardScore: { wards: number; evaluatedIncidents: number; truthWards: number; permutations: number; agents: AgentScore[]; note: string };
  network: { source: string; snapshot: string };
  wards: { source: string; snapshot: string } | null;
  incidents: { source: string; window: string[] };
};
/** The real engine's evaluation. null when the dataset is not prepared, so the console just omits the tab. */
export const fetchScorecard = async (): Promise<Scorecard | null> => {
  try { const r = await fetch("/api/scorecard"); return r.ok ? ((await r.json()) as Scorecard) : null; } catch { return null; }
};

export type Verification = { wards: any; incidents: any; summary: { wards: number; truthWards: number; evaluatedIncidents: number }; note: string };
/** The scorecard as geography. null when the ward dataset is absent, so the console omits the layer. */
export const fetchVerification = async (): Promise<Verification | null> => {
  try { const r = await fetch("/api/verification"); return r.ok ? ((await r.json()) as Verification) : null; } catch { return null; }
};

export const hindcast = {
  meta: () => j<HindcastMeta>("/api/hindcast/meta"),
  geo: () => j<HindcastGeo>("/api/hindcast/geo"),
  run: (p: Record<string, unknown>) => j<HindcastRun>("/api/hindcast/run", send("POST", p)),
};
