import type { Action, Entity, SceneSnapshot } from "../../../../packages/ports/index.ts";
import type { Done } from "../ContextDrawer.tsx";
import type { Bounds } from "./insights.ts";

export type MapInsight = {
  rainHigh?: boolean;
  towersAffected?: boolean;
  socialIds?: string[] | null;
  alertIds?: string[] | null;
};

export type OpsSnapshot = {
  stage: number;
  rain: number;
  ran: boolean;
  busy: boolean;
  focus: string | null;
  mode: "2d" | "3d";
  selected: { id: string; name: string; kind: string } | null;
  vis: Record<string, boolean>;
  doneCount: number;
  entityCount: number;
};

export type OpsHandle = {
  getState: () => OpsSnapshot;
  getEntityContext: () => {
    selected: OpsSnapshot["selected"];
    reasons: { input: string; text: string }[];
    actions: { id: string; kind: string; title: string; detail: string }[];
  };
  setStage: (n: 1 | 2 | 3) => void;
  setRain: (inches: number) => void;
  run: () => void;
  toggle: (key: string) => void;
  pick: (key: string | null) => void;
  selectByQuery: (q: { id?: string; name?: string }) => { ok: boolean; error?: string; id?: string };
  setMode: (m: "2d" | "3d") => void;
  startFly: () => void;
  openPhoto: () => void;
  applyDone: (actionId: string, mode: "assigned" | "issued") => { ok: boolean; error?: string; simulated?: true };
  undoDone: (actionId: string) => { ok: boolean };
  setAlertPreview: (actionId: string | null) => void;
  /** Ensure a visibility key is on (does not toggle off). */
  ensureLayer: (key: string) => void;
  setInsight: (partial: MapInsight | null) => void;
  flyBounds: (bounds: Bounds, maxZoom?: number) => void;
  showHighRainfall: (placeName?: string) => { ok: boolean; [k: string]: unknown };
  showAffectedTowers: () => { ok: boolean; [k: string]: unknown };
  showSocialHotspots: (minPosts?: number) => { ok: boolean; [k: string]: unknown };
  flyToPlace: (name: string) => { ok: boolean; [k: string]: unknown };
  clearInsights: () => { ok: boolean };
  /** Same as the Ask StormAhead bar → intent + factor picker. */
  askStormAhead: (question: string) => Promise<{ ok: boolean; [k: string]: unknown }>;
  /** Same as Deploy on the factor picker. */
  deployAgents: () => { ok: boolean; [k: string]: unknown };
  /** Turn factor-picker chips off (exclude agents before deploy). */
  excludeAgents: (names: string[]) => { ok: boolean; [k: string]: unknown };
  /** Turn factor-picker chips on. */
  includeAgents: (names: string[]) => { ok: boolean; [k: string]: unknown };
  /** Full intel for ORACLE: agents + fusion + report + UI snapshot. */
  getOracleContext: () => { ok: boolean; [k: string]: unknown };
};

export function buildSnapshot(p: {
  stage: number; rain: number; ran: boolean; busy: boolean; focus: string | null;
  mode: "2d" | "3d"; selected: Entity | null; vis: Record<string, boolean>; done: Done; scene: SceneSnapshot | null;
}): OpsSnapshot {
  return {
    stage: p.stage,
    rain: p.rain,
    ran: p.ran,
    busy: p.busy,
    focus: p.focus,
    mode: p.mode,
    selected: p.selected ? { id: p.selected.id, name: p.selected.name, kind: p.selected.kind } : null,
    vis: { ...p.vis },
    doneCount: Object.keys(p.done).length,
    entityCount: p.scene?.entities.length ?? 0,
  };
}

export function resolveEntity(
  scene: SceneSnapshot | null,
  buildings: Map<string, Entity>,
  q: { id?: string; name?: string },
): Entity | null {
  if (!scene) return null;
  if (q.id) {
    return scene.entities.find((e) => e.id === q.id) ?? buildings.get(q.id) ?? null;
  }
  const name = (q.name ?? "").trim().toLowerCase();
  if (!name) return null;
  const pool = [...scene.entities, ...buildings.values()];
  const exact = pool.filter((e) => e.name.toLowerCase() === name);
  if (exact.length === 1) return exact[0]!;
  const partial = pool.filter((e) => e.name.toLowerCase().includes(name));
  if (partial.length === 1) return partial[0]!;
  return null;
}

export function actionIds(actions: Action[]): Set<string> {
  return new Set(actions.map((a) => a.id));
}
