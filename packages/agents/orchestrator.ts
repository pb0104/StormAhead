import { createHash, randomUUID } from "node:crypto";
import * as A from "../analysis/index.ts";
import type { Brief, PreparednessRun } from "../analysis/brief.ts";
import type { AccessChange } from "../analysis/access.ts";
import type { ExposureResult } from "../analysis/exposure.ts";
import type { Dataset, PlanningInputs } from "../shared/schemas.ts";
import { buildTools } from "./tools.ts";

export type AgentName = "Coordinator" | "Hazard Agent" | "Infrastructure Agent" | "Access Agent" | "Resource Planning Agent";
export type AgentEvent = {
  id: string;
  ts: string;
  runId: string;
  agent: AgentName;
  /** "rule-based" = deterministic module; never presented as LLM reasoning. */
  mode: "rule-based" | "llm";
  tool: string;
  inputs: unknown;
  summary: string;
  evidenceIds: string[];
};

export type RunResult = { run: PreparednessRun; brief: Brief; events: AgentEvent[] };

export function hashInputs(ds: Dataset, inputs: PlanningInputs): string {
  const norm = {
    f: ds.meta.forecastVersion,
    i: inputs.inventory,
    d: [...inputs.disabledSiteIds].sort(),
    c: [...inputs.extraClosureIds].sort(),
    t: inputs.thresholdMinutes,
  };
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex").slice(0, 16);
}

/** Inputs the user/coordinator should know are missing or degenerate. */
export function findUnresolvedInputs(ds: Dataset, inputs: PlanningInputs): string[] {
  const out: string[] = [];
  if (ds.hazards.every((h) => h.probability === undefined)) out.push("Scenario probabilities are not available — plans are ranked by worst case; equal-weight averages are illustrative.");
  const enabled = ds.sites.filter((s) => !inputs.disabledSiteIds.includes(s.id));
  if (enabled.length === 0) out.push("All candidate staging sites are disabled — no resource can be placed.");
  for (const t of ["inspection", "rescue"] as const) {
    if (inputs.inventory[t] === 0) out.push(`No ${t} teams in the inventory — demand requiring ${t} is unmet.`);
    else if (!enabled.some((s) => s.compatible.includes(t))) out.push(`No enabled staging site is compatible with ${t} teams.`);
  }
  const cap = enabled.reduce((s, x) => s + x.capacity, 0);
  const n = inputs.inventory.inspection + inputs.inventory.rescue;
  if (n > cap) out.push(`Inventory (${n}) exceeds total enabled staging capacity (${cap}); some resources stay unplaced.`);
  out.push("Real forecast, facility completeness and road-network quality are not connected (synthetic data only).");
  return out;
}

/**
 * Deterministic workflow. Each step is a real tool call recorded as an AgentEvent.
 * Summaries are formatted from tool outputs only.
 */
export async function runPlanningWorkflow(
  ds: Dataset,
  inputs: PlanningInputs,
  opts: { onEvent?: (e: AgentEvent) => void | Promise<void>; stepDelayMs?: number; extraEvidence?: import("../shared/schemas.ts").Evidence[] } = {},
): Promise<RunResult> {
  const runId = `RUN-${randomUUID().slice(0, 8)}`;
  const events: AgentEvent[] = [];
  const evidenceUsed = new Set<string>();
  const tools = buildTools(ds, inputs);

  const emit = async (agent: AgentName, tool: string, inp: unknown, summary: string, evidenceIds: string[] = []) => {
    evidenceIds.forEach((e) => evidenceUsed.add(e));
    const ev: AgentEvent = { id: `${runId}-${events.length + 1}`, ts: new Date().toISOString(), runId, agent, mode: "rule-based", tool, inputs: inp, summary, evidenceIds };
    events.push(ev);
    await opts.onEvent?.(ev);
    if (opts.stepDelayMs) await new Promise((r) => setTimeout(r, opts.stepDelayMs));
  };

  // 0. Temporal guard — fails the run if any post-event / late evidence is in scope.
  const planningEvidence = [...ds.evidence, ...(opts.extraEvidence ?? [])];
  A.assertPreEvent(planningEvidence, ds.meta.asOf);
  await emit("Coordinator", "assertPreEvent", { asOf: ds.meta.asOf, evidenceCount: planningEvidence.length },
    `${planningEvidence.length} evidence items verified pre-event and available by ${ds.meta.asOf}.`, planningEvidence.map((e) => e.id));

  const unresolved = findUnresolvedInputs(ds, inputs);
  await emit("Coordinator", "checkInputs", { inventory: inputs.inventory, disabledSiteIds: inputs.disabledSiteIds, extraClosureIds: inputs.extraClosureIds },
    `${unresolved.length} unresolved/degenerate input note(s) identified.`, ["EV-SYN-INV"]);

  // 1. Hazard
  const hazards = tools.loadHazardScenarios.run();
  await emit("Hazard Agent", "loadHazardScenarios", {}, `${hazards.length} simulated hazard scenarios loaded (${hazards.map((h) => h.severity).join(", ")}); no probabilities supplied.`, hazards.flatMap((h) => h.evidenceIds));

  // 2. Infrastructure
  const exposure: Record<string, ExposureResult> = {};
  for (const h of hazards) {
    const x = tools.findExposedAssets.run({ scenarioId: h.id });
    exposure[h.id] = x;
    await emit("Infrastructure Agent", "findExposedAssets", { scenarioId: h.id },
      `${h.severity}: ${x.exposedEdgeIds.length} road segment(s) exposed incl. ${x.exposedCrossingIds.length} crossing(s) [${x.exposedCrossingIds.join(", ") || "none"}]; ` +
      `${x.exposedButNotClosedEdgeIds.length} exposed but not assumed closed.`, h.evidenceIds.concat("EV-SYN-INFRA"));
  }

  // 3. Access
  const access: Record<string, AccessChange> = {};
  for (const h of hazards) {
    const sim = tools.simulateRoadClosures.run({ scenarioId: h.id, additionalClosureIds: inputs.extraClosureIds });
    const a = tools.calculateAccessChanges.run({ scenarioId: h.id });
    access[h.id] = a;
    const worse = a.pairs.filter((p) => p.changed).length;
    await emit("Access Agent", "simulateRoadClosures + calculateAccessChanges", { scenarioId: h.id, additionalClosureIds: inputs.extraClosureIds },
      `${h.severity}: ${sim.closedEdgeIds.length} edge(s) closed [${sim.closedEdgeIds.join(", ") || "none"}]; ${worse} site→demand route(s) changed; ` +
      `${a.isolatedDemandIds.length} demand location(s) isolated from every eligible site.`, h.evidenceIds);
  }

  // 4. Planning
  const plans = tools.enumerateFeasiblePlacements.run();
  await emit("Resource Planning Agent", "enumerateFeasiblePlacements", { inventory: inputs.inventory, enabledSites: ds.sites.filter((s) => !inputs.disabledSiteIds.includes(s.id)).map((s) => s.id) },
    `${plans.length} feasible placement(s) after capacity/compatibility checks.`, ["EV-SYN-INV"]);
  const evals = plans.map((p) => tools.evaluatePlacement.run({ plan: p }));
  await emit("Resource Planning Agent", "evaluatePlacement", { plans: plans.length, scenarios: ds.hazards.map((h) => h.id) },
    `Evaluated ${evals.length} plan(s) across ${ds.hazards.length} scenarios (threshold ${inputs.thresholdMinutes} min).`, ds.hazards.flatMap((h) => h.evidenceIds));
  const ranked = tools.rankCandidatePlans.run(evals);
  const top = ranked.slice(0, 3);
  await emit("Resource Planning Agent", "rankCandidatePlans", { objective: "max worst-case coverage; tie-break min worst-case mean response" },
    top.length ? `Top plan ${top[0]!.plan.id}: worst-case coverage ${Math.round(top[0]!.worstCaseCoverage * 100)}% in ${top[0]!.worstCaseScenarioId}.` : "No plans.", []);

  const run: PreparednessRun = {
    runId, createdAt: new Date().toISOString(), inputHash: hashInputs(ds, inputs), inputs, asOf: ds.meta.asOf,
    forecastVersion: ds.meta.forecastVersion, exposure, access, candidateCount: plans.length, ranked: top,
    unresolvedInputs: unresolved, evidenceIds: [...evidenceUsed],
  };
  const brief = A.generatePreparednessBrief(run, ds);
  await emit("Coordinator", "generatePreparednessBrief", { runId },
    `Brief assembled: ${brief.evidenceIds.length} evidence item(s) linked; ${brief.unresolvedInputs.length} unresolved input(s) listed.`, brief.evidenceIds);
  return { run, brief, events };
}
