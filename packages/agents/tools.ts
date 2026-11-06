import { z } from "zod";
import * as A from "../analysis/index.ts";
import type { Dataset, Plan, PlanningInputs } from "../shared/schemas.ts";

/**
 * Tool registry. Every analytical function is exposed with a Zod input schema so a future LLM adapter
 * can call them as tool definitions. All numbers come from these functions — never from a model.
 */
export function buildTools(ds: Dataset, inputs: PlanningInputs) {
  const sid = z.object({ scenarioId: z.string() });
  return {
    loadHazardScenarios: {
      description: "Load simulated hazard scenarios with provenance.",
      input: z.object({}),
      run: () => A.loadHazardScenarios(ds),
    },
    findExposedAssets: {
      description: "Geometric intersection of a hazard footprint with mapped roads and assets. Exposure is not closure.",
      input: sid,
      run: ({ scenarioId }: z.infer<typeof sid>) => A.findExposedAssets(ds, scenarioId),
    },
    simulateRoadClosures: {
      description: "Apply the scenario's explicit closures plus extra closures and report open/closed edges.",
      input: z.object({ scenarioId: z.string(), additionalClosureIds: z.array(z.string()).default([]) }),
      run: (i: { scenarioId: string; additionalClosureIds: string[] }) => A.simulateRoadClosures(ds, i.scenarioId, i.additionalClosureIds),
    },
    calculateAccessChanges: {
      description: "Compare site→demand travel times with and without scenario closures; list isolated demand locations.",
      input: sid,
      run: ({ scenarioId }: z.infer<typeof sid>) => A.calculateAccessChanges(ds, scenarioId, inputs.extraClosureIds),
    },
    enumerateFeasiblePlacements: {
      description: "Enumerate capacity- and compatibility-feasible resource placements over enabled staging sites.",
      input: z.object({}),
      run: () => A.enumerateFeasiblePlacements(ds, inputs),
    },
    evaluatePlacement: {
      description: "Evaluate one placement across all supplied scenarios.",
      input: z.object({ plan: z.custom<Plan>() }),
      run: ({ plan }: { plan: Plan }) => A.evaluatePlacement(ds, inputs, plan),
    },
    rankCandidatePlans: {
      description: "Rank by worst-case coverage, then worst-case mean response time.",
      input: z.object({}),
      run: A.rankCandidatePlans,
    },
  };
}
export type Tools = ReturnType<typeof buildTools>;
