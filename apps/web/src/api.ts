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
export const hindcast = {
  meta: () => j<HindcastMeta>("/api/hindcast/meta"),
  geo: () => j<HindcastGeo>("/api/hindcast/geo"),
  run: (p: Record<string, unknown>) => j<HindcastRun>("/api/hindcast/run", send("POST", p)),
};

import type { Closure } from "../../../packages/analysis/replay.ts";
export type HeleneClosure = Closure & { edge: number | null; match: "ref" | "nearest" | "unmatched"; snapDistM: number | null };
export type HeleneMeta = { available: boolean; provenance?: any; counties?: string[]; records?: number; byMatch?: Record<string, number>; byCondition?: Record<string, number>; replayRange?: string[]; caveats?: string[] };
export type HeleneRoads = { nodes: [number, number][]; edges: [number, number, number, number, string, number, string | null, string | null, number, [number, number][] | null][] };
export const helene = {
  meta: () => j<HeleneMeta>("/api/helene/meta"),
  roads: () => j<HeleneRoads>("/api/helene/roads"),
  closures: () => j<{ closures: HeleneClosure[] }>("/api/helene/closures"),
};
