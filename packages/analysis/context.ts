import type { Dataset, HazardScenario, PlanningInputs, RoadEdge, StagingSite } from "../shared/schemas.ts";

export type Ctx = { dataset: Dataset; inputs: PlanningInputs };

export function getScenario(ds: Dataset, id: string): HazardScenario {
  const s = ds.hazards.find((h) => h.id === id);
  if (!s) throw new Error(`Unknown hazard scenario: ${id}`);
  return s;
}

export function nodePosition(ds: Dataset, nodeId: string): [number, number] {
  const a = ds.assets.find((x) => x.id === nodeId);
  if (!a) throw new Error(`Unknown network node: ${nodeId}`);
  return a.position;
}

export function edgeCoords(ds: Dataset, r: RoadEdge): [number, number][] {
  return [nodePosition(ds, r.from), ...r.via, nodePosition(ds, r.to)];
}

export function nodeIds(ds: Dataset): string[] {
  return [...new Set(ds.roads.flatMap((r) => [r.from, r.to]))].sort();
}

/** Edges closed in a scenario = scenario's explicit closures ∪ user-supplied extra closures. */
export function closedEdgesFor(ds: Dataset, scenarioId: string | null, extra: readonly string[]): Set<string> {
  const base = scenarioId ? getScenario(ds, scenarioId).closedEdgeIds : [];
  return new Set([...base, ...extra]);
}

export function isSiteEnabled(site: StagingSite, inputs: PlanningInputs): boolean {
  return !inputs.disabledSiteIds.includes(site.id);
}

/** Site usable in a scenario (explicit eligibility; default eligible). */
export function siteEligibleIn(ds: Dataset, scenarioId: string, siteId: string): boolean {
  return getScenario(ds, scenarioId).siteEligibility[siteId]?.eligible ?? true;
}
