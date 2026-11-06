import type {
  Dataset, DemandResult, Placement, Plan, PlanEvaluation, PlanningInputs, Resource, ScenarioResult,
} from "../shared/schemas.ts";
import { buildGraph, dijkstra } from "./graph.ts";
import { closedEdgesFor, isSiteEnabled, nodeIds, siteEligibleIn } from "./context.ts";

/** Resources implied by the inventory counts. Ids are stable: INS-1, INS-2, RES-1 ... */
export function buildResources(ds: Dataset, inputs: PlanningInputs): Resource[] {
  const mk = (type: "inspection" | "rescue", prefix: string, n: number): Resource[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i + 1}`, type, available: true, startingLocation: ds.startingLocation }));
  return [...mk("inspection", "INS", inputs.inventory.inspection), ...mk("rescue", "RES", inputs.inventory.rescue)];
}

const planKey = (ps: Placement[]) =>
  ps.map((p) => `${p.resourceType}@${p.siteId ?? "none"}`).sort().join("|");

/**
 * Enumerate feasible placements. Disabled sites never appear; capacity and compatibility are respected.
 * A resource is left unplaced ONLY when no enabled, compatible site has remaining capacity.
 * Plans that differ only by swapping identical-type resources are de-duplicated.
 */
export function enumerateFeasiblePlacements(ds: Dataset, inputs: PlanningInputs): Plan[] {
  const resources = buildResources(ds, inputs);
  const sites = ds.sites.filter((s) => isSiteEnabled(s, inputs));
  const left = new Map(sites.map((s) => [s.id, s.capacity]));
  const out = new Map<string, Plan>();

  const rec = (i: number, acc: Placement[]) => {
    if (i === resources.length) {
      const key = planKey(acc);
      if (!out.has(key)) out.set(key, { id: `PLAN-${out.size + 1}`, key, placements: acc.map((p) => ({ ...p })) });
      return;
    }
    const r = resources[i]!;
    const options = sites.filter((s) => s.compatible.includes(r.type) && (left.get(s.id) ?? 0) > 0);
    if (options.length === 0) return rec(i + 1, [...acc, { resourceId: r.id, resourceType: r.type, siteId: null }]);
    for (const s of options) {
      left.set(s.id, left.get(s.id)! - 1);
      rec(i + 1, [...acc, { resourceId: r.id, resourceType: r.type, siteId: s.id }]);
      left.set(s.id, left.get(s.id)! + 1);
    }
  };
  rec(0, []);
  // Stable ids after dedupe, ordered by key for determinism.
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key)).map((p, i) => ({ ...p, id: `PLAN-${i + 1}` }));
}

/** Evaluate one plan across scenarios. Counts each demand once; unreachable => null minutes. */
export function evaluatePlacement(ds: Dataset, inputs: PlanningInputs, plan: Plan, scenarioIds?: string[]): PlanEvaluation {
  const ids = scenarioIds ?? ds.hazards.map((h) => h.id);
  const totalWeight = ds.demands.reduce((s, d) => s + d.weight, 0);
  const threshold = inputs.thresholdMinutes;

  const scenarios: ScenarioResult[] = ids.map((sid) => {
    const g = buildGraph(ds.roads, closedEdgesFor(ds, sid, inputs.extraClosureIds), nodeIds(ds));
    const lost: string[] = [];
    const active = plan.placements.filter((p) => {
      if (p.siteId === null) return false;
      if (!siteEligibleIn(ds, sid, p.siteId)) { lost.push(p.resourceId); return false; }
      return true;
    });
    const distFrom = new Map<string, Map<string, number>>();
    for (const p of active) {
      const site = ds.sites.find((s) => s.id === p.siteId)!;
      if (!distFrom.has(site.nodeId)) distFrom.set(site.nodeId, dijkstra(g, site.nodeId));
    }

    const demands: DemandResult[] = ds.demands.map((d) => {
      const compatible = active.filter((p) => p.resourceType === d.requiredType);
      if (compatible.length === 0) return { demandId: d.id, status: "no-resource", minutes: null, servedBy: null };
      let best: { m: number; rid: string } | null = null;
      for (const p of compatible) {
        const site = ds.sites.find((s) => s.id === p.siteId)!;
        const m = distFrom.get(site.nodeId)!.get(d.nodeId);
        if (m !== undefined && (best === null || m < best.m)) best = { m, rid: p.resourceId };
      }
      if (!best) return { demandId: d.id, status: "unreachable", minutes: null, servedBy: null };
      return { demandId: d.id, status: best.m <= threshold ? "covered" : "late", minutes: best.m, servedBy: best.rid };
    });

    const w = (id: string) => ds.demands.find((d) => d.id === id)!.weight;
    const coveredW = demands.filter((r) => r.status === "covered").reduce((s, r) => s + w(r.demandId), 0);
    const reach = demands.filter((r) => r.minutes !== null);
    const reachW = reach.reduce((s, r) => s + w(r.demandId), 0);
    const mean = reachW ? reach.reduce((s, r) => s + r.minutes! * w(r.demandId), 0) / reachW : null;
    return {
      scenarioId: sid,
      coverage: totalWeight ? coveredW / totalWeight : 0,
      meanResponseMinutes: mean,
      demands,
      unreachableDemandIds: demands.filter((r) => r.status === "unreachable").map((r) => r.demandId),
      unmetDemandIds: demands.filter((r) => r.status === "no-resource").map((r) => r.demandId),
      lostResourceIds: lost,
    };
  });

  const worst = scenarios.reduce((a, b) => (b.coverage < a.coverage ? b : a), scenarios[0]!);
  const means = scenarios.map((s) => s.meanResponseMinutes);
  // Tie-break metric: worst (largest) mean response over scenarios; a scenario with no reachable demand counts as worst.
  const worstMean = means.some((m) => m === null) ? null : Math.max(...(means as number[]));
  return {
    plan,
    scenarios,
    worstCaseCoverage: worst.coverage,
    worstCaseScenarioId: worst.scenarioId,
    worstCaseMeanResponse: worstMean,
    illustrativeMeanCoverage: scenarios.reduce((s, r) => s + r.coverage, 0) / scenarios.length,
  };
}

/** Objective: maximise worst-case coverage; tie-break lower worst-case mean response; then plan key. */
export function rankCandidatePlans(evals: PlanEvaluation[]): PlanEvaluation[] {
  const EPS = 1e-9;
  const rt = (e: PlanEvaluation) => e.worstCaseMeanResponse ?? Number.POSITIVE_INFINITY;
  return [...evals].sort((a, b) => {
    if (Math.abs(a.worstCaseCoverage - b.worstCaseCoverage) > EPS) return b.worstCaseCoverage - a.worstCaseCoverage;
    if (rt(a) !== rt(b)) return rt(a) - rt(b);
    return a.plan.key.localeCompare(b.plan.key);
  });
}
