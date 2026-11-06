import type { Dataset } from "../shared/schemas.ts";
import { buildGraph, components, dijkstra } from "./graph.ts";
import { closedEdgesFor, getScenario, nodeIds, siteEligibleIn } from "./context.ts";

export function simulateRoadClosures(ds: Dataset, scenarioId: string, additionalClosureIds: string[] = []) {
  const unknown = additionalClosureIds.filter((id) => !ds.roads.some((r) => r.id === id));
  if (unknown.length) throw new Error(`Unknown road ids: ${unknown.join(", ")}`);
  const closed = closedEdgesFor(ds, scenarioId, additionalClosureIds);
  return {
    scenarioId,
    closedEdgeIds: [...closed].sort(),
    openEdgeIds: ds.roads.filter((r) => !closed.has(r.id)).map((r) => r.id),
    graph: buildGraph(ds.roads, closed, nodeIds(ds)),
  };
}

export type AccessChange = {
  scenarioId: string;
  closedEdgeIds: string[];
  components: string[][];
  /** Demand nodes sharing a component with NO eligible staging site (nobody can start from there). */
  isolatedDemandIds: string[];
  /** site → demand pairs: baseline vs scenario minutes (null = unreachable). */
  pairs: { siteId: string; demandId: string; baselineMinutes: number | null; scenarioMinutes: number | null; changed: boolean }[];
};

export function calculateAccessChanges(ds: Dataset, scenarioId: string, additionalClosureIds: string[] = []): AccessChange {
  getScenario(ds, scenarioId);
  const sim = simulateRoadClosures(ds, scenarioId, additionalClosureIds);
  const baseG = buildGraph(ds.roads, new Set(), nodeIds(ds));
  const eligibleSites = ds.sites.filter((s) => siteEligibleIn(ds, scenarioId, s.id));
  const comps = components(sim.graph);
  const compOf = (n: string) => comps.find((c) => c.includes(n));
  const isolatedDemandIds = ds.demands
    .filter((d) => !eligibleSites.some((s) => compOf(s.nodeId) === compOf(d.nodeId)))
    .map((d) => d.id);

  const pairs: AccessChange["pairs"] = [];
  for (const s of ds.sites) {
    const base = dijkstra(baseG, s.nodeId);
    const scen = dijkstra(sim.graph, s.nodeId);
    for (const d of ds.demands) {
      const b = base.get(d.nodeId) ?? null;
      const c = scen.get(d.nodeId) ?? null;
      pairs.push({ siteId: s.id, demandId: d.id, baselineMinutes: b, scenarioMinutes: c, changed: b !== c });
    }
  }
  return { scenarioId, closedEdgeIds: sim.closedEdgeIds, components: comps, isolatedDemandIds, pairs };
}
