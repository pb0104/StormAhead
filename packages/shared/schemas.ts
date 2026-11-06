import { z } from "zod";

/** Resource types used in the demo. */
export const ResourceType = z.enum(["inspection", "rescue"]);
export type ResourceType = z.infer<typeof ResourceType>;

export const Position = z.tuple([z.number(), z.number()]); // [lon, lat]
export const Phase = z.enum(["pre-event", "post-event"]);
export type Phase = z.infer<typeof Phase>;

const Iso = z.string().datetime();

/** Evidence keeps observation, publication/availability and retrieval times separate. */
export const Evidence = z.object({
  id: z.string(),
  title: z.string(),
  sourceUrl: z.string().nullable(), // null for purely synthetic inputs
  observedAt: Iso.nullable(), // when the thing was observed / the scenario assumed valid
  availableAt: Iso, // when the information was published / became available to planners
  retrievedAt: Iso, // when this system loaded it
  phase: Phase,
  status: z.enum(["synthetic", "reference-only", "connected"]),
  note: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const Asset = z.object({
  id: z.string(),
  type: z.enum(["settlement", "hospital", "shelter", "crossing", "junction", "staging"]),
  name: z.string(),
  position: Position,
  source: z.string(),
  timestamp: Iso,
  simulated: z.literal(true),
  evidenceIds: z.array(z.string()),
  /** For crossing assets: the road edge this asset represents. */
  edgeId: z.string().optional(),
});
export type Asset = z.infer<typeof Asset>;

export const RoadEdge = z.object({
  id: z.string(),
  name: z.string(),
  from: z.string(),
  to: z.string(),
  kind: z.enum(["road", "bridge", "track"]),
  travelMinutes: z.number().positive(),
  /** Optional intermediate vertices for drawing / spatial intersection. */
  via: z.array(Position).default([]),
  provenance: z.string(),
  simulated: z.literal(true),
});
export type RoadEdge = z.infer<typeof RoadEdge>;

export const HazardScenario = z.object({
  id: z.string(),
  label: z.string(),
  severity: z.enum(["low", "medium", "severe"]),
  /** GeoJSON MultiPolygon coordinates (lon/lat). */
  footprint: z.array(z.array(z.array(Position))),
  timeWindow: z.object({ start: Iso, end: Iso }),
  /** Edges the scenario assumes are IMPASSABLE. Exposure alone does not close an edge. */
  closedEdgeIds: z.array(z.string()),
  closureBasis: z.string(),
  /** Explicit scenario-specific staging eligibility; absent = eligible. */
  siteEligibility: z.record(z.string(), z.object({ eligible: z.boolean(), reason: z.string() })).default({}),
  probability: z.number().min(0).max(1).optional(), // intentionally unset in demo data
  source: z.string(),
  simulated: z.literal(true),
  evidenceIds: z.array(z.string()),
});
export type HazardScenario = z.infer<typeof HazardScenario>;

export const StagingSite = z.object({
  id: z.string(),
  name: z.string(),
  nodeId: z.string(),
  capacity: z.number().int().nonnegative(),
  compatible: z.array(ResourceType),
  simulated: z.literal(true),
});
export type StagingSite = z.infer<typeof StagingSite>;

export const Resource = z.object({
  id: z.string(),
  type: ResourceType,
  available: z.boolean(),
  startingLocation: z.string(),
});
export type Resource = z.infer<typeof Resource>;

export const DemandLocation = z.object({
  id: z.string(),
  name: z.string(),
  nodeId: z.string(),
  requiredType: ResourceType,
  weight: z.number().positive(),
});
export type DemandLocation = z.infer<typeof DemandLocation>;

export const Dataset = z.object({
  meta: z.object({
    name: z.string(),
    forecastVersion: z.string(),
    asOf: Iso, // planning cut-off: nothing available after this may influence the plan
    simulated: z.literal(true),
    disclaimer: z.string(),
    responseThresholdMinutes: z.number().positive(),
  }),
  assets: z.array(Asset),
  roads: z.array(RoadEdge),
  hazards: z.array(HazardScenario),
  sites: z.array(StagingSite),
  defaultInventory: z.record(z.string(), z.number().int().nonnegative()),
  startingLocation: z.string(),
  demands: z.array(DemandLocation),
  evidence: z.array(Evidence),
});
export type Dataset = z.infer<typeof Dataset>;

/** User-controlled planning inputs. */
export const PlanningInputs = z.object({
  inventory: z.object({ inspection: z.number().int().min(0).max(10), rescue: z.number().int().min(0).max(10) }),
  disabledSiteIds: z.array(z.string()),
  extraClosureIds: z.array(z.string()),
  thresholdMinutes: z.number().positive(),
});
export type PlanningInputs = z.infer<typeof PlanningInputs>;

// ---------- Result types (plain TS; produced by analysis tools) ----------

export type Placement = { resourceId: string; resourceType: ResourceType; siteId: string | null };
export type Plan = { id: string; key: string; placements: Placement[] };

export type DemandStatus = "covered" | "late" | "unreachable" | "no-resource";
export type DemandResult = {
  demandId: string;
  status: DemandStatus;
  minutes: number | null; // null whenever not reachable / no resource — never a fake finite number
  servedBy: string | null; // resource id
};
export type ScenarioResult = {
  scenarioId: string;
  coverage: number; // weighted fraction in [0,1] served within threshold
  meanResponseMinutes: number | null; // over reachable demands only; null if none
  demands: DemandResult[];
  unreachableDemandIds: string[];
  unmetDemandIds: string[]; // no compatible resource available at all
  lostResourceIds: string[]; // placed at a site that is ineligible in this scenario
};
export type PlanEvaluation = {
  plan: Plan;
  scenarios: ScenarioResult[];
  worstCaseCoverage: number;
  worstCaseScenarioId: string;
  worstCaseMeanResponse: number | null;
  /** Equal-weight mean — illustrative only, NOT a calibrated expectation. */
  illustrativeMeanCoverage: number;
};
