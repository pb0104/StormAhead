import { booleanIntersects } from "@turf/boolean-intersects";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { lineString, multiPolygon, point } from "@turf/helpers";
import type { Dataset, HazardScenario } from "../shared/schemas.ts";
import { buildGraph, dijkstra } from "./graph.ts";
import { edgeCoords, getScenario, nodeIds } from "./context.ts";

export type ExposureResult = {
  scenarioId: string;
  exposedEdgeIds: string[];
  exposedAssetIds: string[]; // includes crossing assets whose edge is exposed
  exposedCrossingIds: string[]; // edge ids with kind === "bridge"
  /** Explicitly assumed closures (a subset of, or independent from, exposure). Exposure != closure. */
  assumedClosedEdgeIds: string[];
  exposedButNotClosedEdgeIds: string[];
  /** For each exposed edge: demand locations that lose access from at least one other-wise eligible site if that edge alone closed. */
  dependencies: { edgeId: string; affectedDemandIds: string[] }[];
};

export function loadHazardScenarios(ds: Dataset): HazardScenario[] {
  return ds.hazards;
}

function footprint(h: HazardScenario) {
  return multiPolygon(h.footprint);
}

/** Pure geometry: which mapped assets/edges intersect the hazard footprint. */
export function findExposedAssets(ds: Dataset, scenarioId: string): ExposureResult {
  const h = getScenario(ds, scenarioId);
  const fp = footprint(h);
  const exposedEdges = ds.roads.filter((r) => booleanIntersects(lineString(edgeCoords(ds, r)), fp));
  const exposedEdgeIds = exposedEdges.map((r) => r.id);
  const exposedAssetIds = ds.assets
    .filter((a) => (a.edgeId ? exposedEdgeIds.includes(a.edgeId) : booleanPointInPolygon(point(a.position), fp)))
    .map((a) => a.id);

  // Dependency analysis: which demands become cut off from ALL staging sites if just this edge closed.
  const siteNodes = ds.sites.map((s) => s.nodeId);
  const baseClosed = new Set(h.closedEdgeIds);
  const dependencies = exposedEdges.map((e) => {
    const g = buildGraph(ds.roads, new Set([...baseClosed, e.id]), nodeIds(ds));
    const reach = new Set<string>();
    for (const s of siteNodes) for (const n of dijkstra(g, s).keys()) reach.add(n);
    return { edgeId: e.id, affectedDemandIds: ds.demands.filter((d) => !reach.has(d.nodeId)).map((d) => d.id) };
  });

  return {
    scenarioId,
    exposedEdgeIds,
    exposedAssetIds,
    exposedCrossingIds: exposedEdges.filter((r) => r.kind === "bridge").map((r) => r.id),
    assumedClosedEdgeIds: [...h.closedEdgeIds],
    exposedButNotClosedEdgeIds: exposedEdgeIds.filter((id) => !h.closedEdgeIds.includes(id)),
    dependencies,
  };
}
