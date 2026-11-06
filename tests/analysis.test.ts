import { describe, expect, it } from "vitest";
import * as A from "../packages/analysis/index.ts";
import { runPlanningWorkflow } from "../packages/agents/orchestrator.ts";
import { Dataset } from "../packages/shared/schemas.ts";
import { defaultInputs, ds } from "./helpers.ts";

const plan = (placements: [string, "inspection" | "rescue", string | null][]) => ({
  id: "T", key: "T", placements: placements.map(([resourceId, resourceType, siteId]) => ({ resourceId, resourceType, siteId })),
});

describe("phase 1 — dataset", () => {
  it("validates, with every closure inside or independent of exposure and eligibility explained", () => {
    const d = ds();
    expect(d.meta.simulated).toBe(true);
    expect(d.assets.every((a) => a.simulated)).toBe(true);
    expect(d.hazards.every((h) => h.probability === undefined)).toBe(true); // never invent probabilities
  });
  it("rejects dangling references", () => {
    const d = ds();
    d.roads[0]!.from = "n_NOPE";
    expect(() => A.validateDataset(d)).toThrow(/unknown node/);
  });
  it("rejects non-simulated data (schema enforces the label)", () => {
    const d: any = ds();
    d.assets[0].simulated = false;
    expect(() => Dataset.parse(d)).toThrow();
  });
});

describe("exposure vs closure", () => {
  it("low scenario exposes only Bridge 1 and closes nothing", () => {
    const x = A.findExposedAssets(ds(), "HZ-LOW");
    expect(x.exposedEdgeIds).toEqual(["B1"]);
    expect(x.assumedClosedEdgeIds).toEqual([]);
    expect(x.exposedAssetIds).toContain("A_BR1");
  });
  it("severe: exposed roads are not automatically closed", () => {
    const x = A.findExposedAssets(ds(), "HZ-SEV");
    expect(x.exposedEdgeIds).toEqual(expect.arrayContaining(["B1", "B2", "R12", "R1", "R4"]));
    expect(x.exposedButNotClosedEdgeIds).toContain("R1");
    expect(x.assumedClosedEdgeIds.sort()).toEqual(["B1", "B2", "R12"]);
    expect(x.exposedAssetIds).toContain("n_S1");
    expect(x.exposedAssetIds).toContain("n_ST3");
  });
  it("every ineligible staging site lies in that scenario's exposed assets", () => {
    const d = ds();
    for (const h of d.hazards)
      for (const [site, e] of Object.entries(h.siteEligibility))
        if (!e.eligible) expect(A.findExposedAssets(d, h.id).exposedAssetIds).toContain(d.sites.find((s) => s.id === site)!.nodeId);
  });
});

describe("routing / access", () => {
  it("closing Bridge 1 and the mountain track disconnects the west side", () => {
    const d = ds();
    const g = A.buildGraph(d.roads, new Set(["B1", "R12"]), A.nodeIds(d));
    const reach = new Set(A.dijkstra(g, "n_ST1").keys());
    expect([...reach].sort()).toEqual(["n_B1w", "n_S1", "n_ST1"]);
    expect(reach.has("n_S2")).toBe(false);
  });
  it("Dijkstra finds known shortest times", () => {
    const d = ds();
    const dist = A.dijkstra(A.buildGraph(d.roads, new Set(), A.nodeIds(d)), "n_ST2");
    expect(dist.get("n_H1")).toBe(10);
    expect(dist.get("n_S3")).toBe(6 + 10 + 3 + 8); // via Bridge 2
  });
  it("calculateAccessChanges reports isolation in severe, none in low", () => {
    const d = ds();
    expect(A.calculateAccessChanges(d, "HZ-LOW").isolatedDemandIds).toEqual([]);
    // Severe: ST1 (west) is eligible so west demand is not isolated; disable ST1 → west isolated.
    const sev = A.calculateAccessChanges(d, "HZ-SEV");
    expect(sev.isolatedDemandIds).toEqual([]);
    const pair = sev.pairs.find((p) => p.siteId === "ST2" && p.demandId === "DM-S1-R")!;
    expect(pair.baselineMinutes).not.toBeNull();
    expect(pair.scenarioMinutes).toBeNull();
    expect(pair.changed).toBe(true);
  });
  it("extra closures apply on top of the scenario", () => {
    const d = ds();
    expect(A.simulateRoadClosures(d, "HZ-LOW", ["R5"]).closedEdgeIds).toEqual(["R5"]);
    expect(() => A.simulateRoadClosures(d, "HZ-LOW", ["NOPE"])).toThrow();
  });
});

describe("placement", () => {
  it("unreachable demands get null minutes, never a finite number", () => {
    const d = ds();
    const ev = A.evaluatePlacement(d, defaultInputs(d), plan([["INS-1", "inspection", "ST2"], ["INS-2", "inspection", "ST2"], ["RES-1", "rescue", "ST2"]]));
    const sev = ev.scenarios.find((s) => s.scenarioId === "HZ-SEV")!;
    const s1 = sev.demands.find((x) => x.demandId === "DM-S1-R")!;
    expect(s1.status).toBe("unreachable");
    expect(s1.minutes).toBeNull();
    expect(sev.unreachableDemandIds).toContain("DM-S1-R");
  });
  it("incompatible resources do not satisfy demand", () => {
    const d = ds();
    const ev = A.evaluatePlacement(d, defaultInputs(d), plan([["INS-1", "inspection", "ST2"]]));
    for (const s of ev.scenarios) {
      for (const r of s.demands.filter((x) => d.demands.find((y) => y.id === x.demandId)!.requiredType === "rescue"))
        expect(r.status).toBe("no-resource");
    }
  });
  it("respects site capacity and inventory in every enumerated plan", () => {
    const d = ds();
    const inputs = defaultInputs(d);
    const plans = A.enumerateFeasiblePlacements(d, inputs);
    expect(plans.length).toBeGreaterThan(1);
    for (const p of plans) {
      expect(p.placements.filter((x) => x.resourceType === "inspection")).toHaveLength(2);
      expect(p.placements.filter((x) => x.resourceType === "rescue")).toHaveLength(1);
      for (const s of d.sites) expect(p.placements.filter((x) => x.siteId === s.id).length).toBeLessThanOrEqual(s.capacity);
    }
    expect(new Set(plans.map((p) => p.key)).size).toBe(plans.length); // identical-type swaps de-duplicated
  });
  it("leaves resources unplaced only when capacity is exhausted", () => {
    const d = ds();
    const inputs = { ...defaultInputs(d), inventory: { inspection: 6, rescue: 0 } };
    const plans = A.enumerateFeasiblePlacements(d, inputs);
    for (const p of plans) expect(p.placements.filter((x) => x.siteId === null)).toHaveLength(1); // capacity 5 of 6
  });
  it("disabled sites never appear in any plan", () => {
    const d = ds();
    const plans = A.enumerateFeasiblePlacements(d, { ...defaultInputs(d), disabledSiteIds: ["ST2"] });
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) expect(p.placements.some((x) => x.siteId === "ST2")).toBe(false);
  });
  it("zero resources yields an explicit unmet-demand result", () => {
    const d = ds();
    const inputs = { ...defaultInputs(d), inventory: { inspection: 0, rescue: 0 } };
    const plans = A.enumerateFeasiblePlacements(d, inputs);
    expect(plans).toHaveLength(1);
    const ev = A.evaluatePlacement(d, inputs, plans[0]!);
    for (const s of ev.scenarios) {
      expect(s.coverage).toBe(0);
      expect(s.unmetDemandIds).toHaveLength(d.demands.length);
      expect(s.meanResponseMinutes).toBeNull();
    }
    expect(ev.worstCaseMeanResponse).toBeNull();
  });
  it("does not double count demand covered by several resources", () => {
    const d = ds();
    const inputs = { ...defaultInputs(d), inventory: { inspection: 0, rescue: 2 } };
    const one = A.evaluatePlacement(d, inputs, plan([["RES-1", "rescue", "ST2"]]), ["HZ-LOW"]);
    const two = A.evaluatePlacement(d, inputs, plan([["RES-1", "rescue", "ST2"], ["RES-2", "rescue", "ST2"]]), ["HZ-LOW"]);
    expect(two.scenarios[0]!.coverage).toBe(one.scenarios[0]!.coverage);
    expect(two.scenarios[0]!.coverage).toBeLessThanOrEqual(1);
  });
  it("resources at a scenario-ineligible site are lost in that scenario", () => {
    const d = ds();
    const ev = A.evaluatePlacement(d, defaultInputs(d), plan([["RES-1", "rescue", "ST3"]]));
    expect(ev.scenarios.find((s) => s.scenarioId === "HZ-SEV")!.lostResourceIds).toEqual(["RES-1"]);
    expect(ev.scenarios.find((s) => s.scenarioId === "HZ-LOW")!.lostResourceIds).toEqual([]);
  });
  it("ranks by worst-case coverage first, then response time", () => {
    const d = ds();
    const inputs = defaultInputs(d);
    const evals = A.enumerateFeasiblePlacements(d, inputs).map((p) => A.evaluatePlacement(d, inputs, p));
    const ranked = A.rankCandidatePlans(evals);
    for (let i = 1; i < ranked.length; i++) {
      const a = ranked[i - 1]!, b = ranked[i]!;
      expect(a.worstCaseCoverage).toBeGreaterThanOrEqual(b.worstCaseCoverage - 1e-9);
      if (Math.abs(a.worstCaseCoverage - b.worstCaseCoverage) < 1e-9)
        expect(a.worstCaseMeanResponse ?? Infinity).toBeLessThanOrEqual(b.worstCaseMeanResponse ?? Infinity);
    }
  });
  it("removing a team / closing a road changes the result", () => {
    const d = ds();
    const base = defaultInputs(d);
    const full = A.rankCandidatePlans(A.enumerateFeasiblePlacements(d, base).map((p) => A.evaluatePlacement(d, base, p)))[0]!;
    const fewer = { ...base, inventory: { inspection: 1, rescue: 1 } };
    const less = A.rankCandidatePlans(A.enumerateFeasiblePlacements(d, fewer).map((p) => A.evaluatePlacement(d, fewer, p)))[0]!;
    expect(less.worstCaseCoverage).toBeLessThanOrEqual(full.worstCaseCoverage);
    expect(less.plan.placements).toHaveLength(2);
  });
});

describe("temporal separation and evidence", () => {
  const post = {
    id: "EV-POST", title: "post-event imagery", sourceUrl: "https://example.org", observedAt: "2024-09-28T00:00:00Z",
    availableAt: "2024-09-30T00:00:00Z", retrievedAt: "2026-11-06T00:00:00Z", phase: "post-event" as const, status: "reference-only" as const,
  };
  it("post-event evidence cannot enter a planning run", async () => {
    const d = ds();
    await expect(runPlanningWorkflow(d, defaultInputs(d), { extraEvidence: [post] })).rejects.toBeInstanceOf(A.TemporalLeakError);
  });
  it("pre-event-labelled evidence published after the cut-off is also rejected", async () => {
    const d = ds();
    await expect(runPlanningWorkflow(d, defaultInputs(d), { extraEvidence: [{ ...post, phase: "pre-event" }] })).rejects.toThrow(/Temporal separation/);
  });
  it("post-event reference data is kept out of the planning dataset", () => {
    const d = ds();
    const ref = A.loadPostEventReference();
    expect(ref.evidence.length).toBeGreaterThan(0);
    for (const e of ref.evidence) {
      expect(e.phase).toBe("post-event");
      expect(d.evidence.some((x) => x.id === e.id)).toBe(false);
    }
  });
  it("evidence ids survive into the brief and agent events", async () => {
    const d = ds();
    const { brief, run, events } = await runPlanningWorkflow(d, defaultInputs(d));
    for (const id of ["EV-SYN-HAZ-LOW", "EV-SYN-HAZ-MED", "EV-SYN-HAZ-SEV", "EV-SYN-INFRA", "EV-SYN-INV"]) {
      expect(brief.evidenceIds).toContain(id);
      expect(brief.evidence.map((e) => e.id)).toContain(id);
    }
    expect(run.ranked.length).toBeLessThanOrEqual(3);
    expect(events.every((e) => e.mode === "rule-based")).toBe(true);
    expect(events.some((e) => e.agent === "Infrastructure Agent" && e.tool === "findExposedAssets")).toBe(true);
    expect(events.flatMap((e) => e.evidenceIds).length).toBeGreaterThan(0);
  });
});
