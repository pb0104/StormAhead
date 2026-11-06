import type { Dataset, Evidence, PlanEvaluation, PlanningInputs } from "../shared/schemas.ts";
import type { ExposureResult } from "./exposure.ts";
import type { AccessChange } from "./access.ts";

export type PreparednessRun = {
  runId: string;
  createdAt: string;
  inputHash: string;
  inputs: PlanningInputs;
  asOf: string;
  forecastVersion: string;
  exposure: Record<string, ExposureResult>;
  access: Record<string, AccessChange>;
  candidateCount: number;
  ranked: PlanEvaluation[]; // top plans (≤3)
  unresolvedInputs: string[];
  evidenceIds: string[];
};

export type Brief = {
  runId: string;
  banner: string;
  headline: string;
  recommendedPlanId: string | null;
  rankingExplanation: string[];
  tradeoffs: string[];
  scenarioFindings: string[];
  assumptions: string[];
  limitations: string[];
  unresolvedInputs: string[];
  evidenceIds: string[];
  evidence: Evidence[];
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
export const describePlacements = (e: PlanEvaluation, ds: Dataset) =>
  e.plan.placements
    .map((p) => `${p.resourceId} → ${p.siteId ? ds.sites.find((s) => s.id === p.siteId)?.name ?? p.siteId : "UNPLACED"}`)
    .join(", ");

export const ASSUMPTIONS = [
  "All assets, roads, travel times, hazard footprints and inventories are SIMULATED.",
  "Closures are explicit scenario assumptions; intersecting a hazard footprint means EXPOSED, not impassable.",
  "Scenario probabilities are not available and were not invented; equal-weight averages are illustrative only.",
  "A site ineligible in a scenario removes any resource staged there in that scenario (it is not relocated).",
  "A demand counts as covered if its nearest compatible, available resource arrives within the response threshold; each demand is counted once.",
];
export const LIMITATIONS = [
  "Measures modeled accessibility and coverage — not lives saved or operational deployment safety.",
  "No live forecast, imagery, social or camera data is connected in this build.",
  "Travel times are static; no congestion, debris, timing of rising water, or resource mobilisation delays.",
];

/** Build the brief purely from run results. Numbers are formatted from analytical output, never estimated. */
export function generatePreparednessBrief(run: PreparednessRun, ds: Dataset): Brief {
  const [best, ...others] = run.ranked;
  const evIds = [...new Set(run.evidenceIds)];
  const base = {
    runId: run.runId,
    banner: ds.meta.disclaimer,
    assumptions: ASSUMPTIONS,
    limitations: LIMITATIONS,
    unresolvedInputs: run.unresolvedInputs,
    evidenceIds: evIds,
    evidence: ds.evidence.filter((e) => evIds.includes(e.id)),
  };
  const scenarioFindings = ds.hazards.map((h) => {
    const x = run.exposure[h.id]!;
    const a = run.access[h.id]!;
    return (
      `${h.label}: ${x.exposedEdgeIds.length} exposed road segment(s) (${x.exposedCrossingIds.length} crossing(s)); ` +
      `${a.closedEdgeIds.length} closed (${a.closedEdgeIds.join(", ") || "none"}); ` +
      `${a.isolatedDemandIds.length} demand location(s) with no eligible staging site in their component.`
    );
  });
  if (!best) {
    return { ...base, headline: "No feasible plan could be generated.", recommendedPlanId: null, rankingExplanation: [], tradeoffs: [], scenarioFindings };
  }
  const zero = best.scenarios.every((s) => s.unmetDemandIds.length === ds.demands.length);
  const headline = zero
    ? "No resources are available: all demand is unmet in every scenario."
    : `Recommended ${best.plan.id}: worst-case modeled coverage ${pct(best.worstCaseCoverage)} (in ${best.worstCaseScenarioId}), ${describePlacements(best, ds)}.`;
  const rankingExplanation = run.ranked.map((e, i) => {
    const perScen = e.scenarios.map((s) => `${s.scenarioId} ${pct(s.coverage)}`).join(", ");
    const rt = e.worstCaseMeanResponse === null ? "n/a" : `${e.worstCaseMeanResponse.toFixed(1)} min`;
    return `#${i + 1} ${e.plan.id}: worst-case coverage ${pct(e.worstCaseCoverage)}; worst-case mean response ${rt}; by scenario: ${perScen}; illustrative equal-weight mean ${pct(e.illustrativeMeanCoverage)}.`;
  });
  const tradeoffs = others.map((o) => {
    const diffs = best.scenarios.map((bs, i) => {
      const os = o.scenarios[i]!;
      const d = Math.round((os.coverage - bs.coverage) * 100);
      return d === 0 ? null : `${d > 0 ? "+" : ""}${d} pts in ${bs.scenarioId}`;
    }).filter(Boolean);
    return `${o.plan.id} vs recommended: ${diffs.length ? diffs.join(", ") : "identical coverage in every scenario"}; ${describePlacements(o, ds)}.`;
  });
  const lost = best.scenarios.filter((s) => s.lostResourceIds.length).map((s) => `${s.scenarioId}: ${s.lostResourceIds.join(", ")} unavailable (staged at an ineligible site)`);
  if (lost.length) tradeoffs.push(`Recommended plan loses resources in some scenarios — ${lost.join("; ")}.`);
  return { ...base, headline, recommendedPlanId: best.plan.id, rankingExplanation, tradeoffs, scenarioFindings };
}
