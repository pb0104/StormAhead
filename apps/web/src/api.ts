import type { Dataset, PlanningInputs } from "../../../packages/shared/schemas.ts";
import type { Action, RunRecord } from "../../api/service.ts";
import type { ExposureResult } from "../../../packages/analysis/exposure.ts";
import type { Evidence } from "../../../packages/shared/schemas.ts";

export type { Action, RunRecord };
export type Evaluation = { note: string; connected: boolean; evidence: Evidence[]; message: string; latestRecommendation: string | null };

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: init?.body ? { "Content-Type": "application/json" } : {} });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as any).error ?? `HTTP ${r.status}`);
  return body as T;
}
const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  dataset: () => j<{ dataset: Dataset; inputs: PlanningInputs; inputHash: string }>("/api/dataset"),
  exposure: () => j<Record<string, ExposureResult>>("/api/exposure"),
  latest: () => j<{ run: RunRecord | null }>("/api/runs/latest"),
  setInputs: (p: Partial<PlanningInputs>) => j<{ inputs: PlanningInputs }>("/api/inputs", send("PUT", p)),
  plan: () => j<RunRecord>("/api/plan", send("POST")),
  review: (id: string, body: { decision: string; reviewer: string; planId?: string; notes?: string }) =>
    j<RunRecord>(`/api/runs/${id}/review`, send("POST", body)),
  assign: (id: string) => j<{ actions: Action[] }>(`/api/runs/${id}/assignments`, send("POST")),
  inbox: () => j<{ actions: Action[] }>("/api/inbox"),
  evaluation: () => j<Evaluation>("/api/evaluation"),
  reset: () => j<unknown>("/api/reset", send("POST")),
};
