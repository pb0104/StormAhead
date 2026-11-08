import { describe, expect, it } from "vitest";
import { confusion, DEFAULT_WARD_SCORE, scoreByWard, wardIndex, type Ward } from "../packages/analysis/wards.ts";
import { analyzeCascade, type Incident, type RealArea, type RealEdge } from "../packages/analysis/cascade.ts";

/** A square ward of side ~0.01 deg, placed on the same road chain the cascade tests use. */
const W = (id: number, lon: number, lat = 27.7): Ward => ({
  id, name: `W${id}`, ward: String(id), municipality: "Test",
  areaM2: 1e6, at: [lon, lat],
  rings: [[[lon - 0.005, lat - 0.005], [lon + 0.005, lat - 0.005], [lon + 0.005, lat + 0.005], [lon - 0.005, lat + 0.005], [lon - 0.005, lat - 0.005]]],
});

describe("confusion matrix", () => {
  it("counts hits, false alarms and misses, and leaves the rest as true negatives", () => {
    const c = confusion(new Set([1, 2, 3]), new Set([2, 3, 4]), 10);
    expect(c).toMatchObject({ tp: 2, fp: 1, fn: 1, tn: 6 });
    expect(c.precision).toBeCloseTo(2 / 3);
    expect(c.recall).toBeCloseTo(2 / 3);
    expect(c.f1).toBeCloseTo(2 / 3);
    expect(c.iou).toBeCloseTo(2 / 4);
  });
  it("punishes flagging everything, which the old radius test could not", () => {
    const all = confusion(new Set(Array.from({ length: 100 }, (_, i) => i)), new Set([1, 2]), 100);
    expect(all.recall).toBe(1);        // perfect recall…
    expect(all.precision).toBeCloseTo(0.02); // …but the precision exposes it
    expect(all.fp).toBe(98);
  });
  it("reports null rather than NaN when nothing is flagged or nothing is true", () => {
    expect(confusion(new Set(), new Set([1]), 5).precision).toBeNull();
    expect(confusion(new Set([1]), new Set(), 5).recall).toBeNull();
  });
});

describe("ward lookup", () => {
  it("finds the ward a point falls in, and -1 outside every ward", () => {
    const wards = [W(1, 85.30), W(2, 85.32)];
    const find = wardIndex(wards);
    expect(find(85.30, 27.7)).toBe(0);
    expect(find(85.32, 27.7)).toBe(1);
    expect(find(85.40, 27.7)).toBe(-1);
    expect(find(85.30, 27.9)).toBe(-1);
  });
});

// Reuse the cascade tests' area: chain 0-1-2-3-4-5, flooded bridge 5-6, right chain 6-7-8.
const E = (u: number, v: number, minutes: number, extra: Partial<RealEdge> = {}): RealEdge => ({
  u, v, minutes, lengthM: minutes * 300, cls: "residential", bridge: false, floodedShare: 0, name: null, osmWayId: u * 100 + v,
  mid: [85.3 + (u + v) * 0.005, 27.7], distFloodM: 5000, via: null, ...extra,
});
const P = (id: number, node: number, extra = {}) => ({ id, name: `P${id}`, lon: 85.3 + node * 0.01, lat: 27.7, node, inFlood: false, distFloodM: 3000, ...extra });
const nodes = Array.from({ length: 9 }, (_, i) => [85.3 + i * 0.01, 27.7] as [number, number]);
const area: RealArea = {
  nodes,
  edges: [E(0, 1, 2), E(1, 2, 2), E(2, 3, 2), E(3, 4, 2), E(4, 5, 2), E(5, 6, 2, { bridge: true, floodedShare: 0.2 }), E(6, 7, 2), E(7, 8, 2)],
  places: [P(1, 2), P(2, 7), P(3, 8), P(4, 5, { inFlood: true, distFloodM: 0 })],
  hospitals: [P(100, 0)],
};
const inc = (id: number, lon: number, over: Partial<Incident> = {}): Incident => ({
  id, title: `I${id}`, lon, lat: 27.7, hazard: "Flood", floodRelated: true, hasImpact: true, distFloodM: 800, incidentOn: "2024-09-28", loss: {}, ...over,
});

describe("per-agent ward scorecard", () => {
  const wards = [85.30, 85.32, 85.34, 85.36, 85.38].map((lon, i) => W(i + 1, lon));
  const res = analyzeCascade(area);
  const opt = { ...DEFAULT_WARD_SCORE, permutations: 200 };

  it("scores each agent separately and always includes the given hazard as the bar to beat", () => {
    const s = scoreByWard(area, res, [inc(1, 85.36)], wards, opt);
    const names = s.agents.map((a) => a.agent);
    expect(names).toContain("Infrastructure Agent");
    expect(names).toContain("Access Agent");
    expect(names).toContain("All agents combined");
    expect(names[0]).toMatch(/GIVEN, not a prediction/); // the hazard row comes first and is labelled
    expect(s.wards).toBe(5);
  });
  it("counts only verified, impactful, primary-hazard incidents as ground truth", () => {
    const s = scoreByWard(area, res, [
      inc(1, 85.36),
      inc(2, 85.30, { hazard: "Landslide" }),   // not a primary hazard
      inc(3, 85.32, { hasImpact: false }),       // no reported impact
      inc(4, 85.34, { floodRelated: false }),    // unrelated
    ], wards, opt);
    expect(s.evaluatedIncidents).toBe(1);
    expect(s.truthWards).toBe(1);
  });
  it("an incident outside every ward is evaluated but lands in no truth ward", () => {
    const s = scoreByWard(area, res, [inc(1, 99)], wards, opt);
    expect(s.evaluatedIncidents).toBe(1);
    expect(s.truthWards).toBe(0);
  });
  it("baselines are drawn the same size as the agent's own flagged set", () => {
    const s = scoreByWard(area, res, [inc(1, 85.36)], wards, opt);
    for (const a of s.agents) {
      expect(a.randomBaseline.meanTp).toBeLessThanOrEqual(a.flaggedWards);
      expect(a.randomBaseline.p).toBeGreaterThan(0);
      expect(a.randomBaseline.p).toBeLessThanOrEqual(1);
      const c = a.confusion;
      expect(c.tp + c.fp).toBe(a.flaggedWards);          // every flagged ward is a hit or a false alarm
      expect(c.tp + c.fp + c.fn + c.tn).toBe(s.wards);   // the matrix covers every ward exactly once
    }
  });
  it("is reproducible for a fixed seed", () => {
    const a = scoreByWard(area, res, [inc(1, 85.36)], wards, opt);
    const b = scoreByWard(area, res, [inc(1, 85.36)], wards, opt);
    expect(JSON.stringify(a.agents)).toEqual(JSON.stringify(b.agents));
  });
});

describe("per-ward outcomes, for the verification map", () => {
  const wards = [85.30, 85.32, 85.34, 85.36, 85.38].map((lon, i) => W(i + 1, lon));
  const res = analyzeCascade(area);
  const opt = { ...DEFAULT_WARD_SCORE, permutations: 100 };

  it("labels every ward exactly once, and the labels agree with the confusion matrix", () => {
    const s = scoreByWard(area, res, [inc(1, 85.36)], wards, opt);
    expect(s.detail).toHaveLength(wards.length);
    const n = (o: string) => s.detail.filter((d) => d.outcome === o).length;
    expect(n("hit") + n("false-alarm") + n("miss") + n("correct-reject")).toBe(wards.length);
    const combined = s.agents.find((a) => a.agent === "All agents combined")!.confusion;
    expect(n("hit")).toBe(combined.tp);
    expect(n("false-alarm")).toBe(combined.fp);
    expect(n("miss")).toBe(combined.fn);
    expect(n("correct-reject")).toBe(combined.tn);
  });
  it("a flagged ward that reported damage is a hit; an unflagged one that did is a miss", () => {
    const s = scoreByWard(area, res, [inc(1, 85.36)], wards, opt);
    for (const d of s.detail) {
      if (d.outcome === "hit") { expect(d.flaggedBy.length).toBeGreaterThan(0); expect(d.reported).toBe(true); }
      if (d.outcome === "miss") { expect(d.flaggedBy).toEqual([]); expect(d.reported).toBe(true); }
      if (d.outcome === "false-alarm") { expect(d.flaggedBy.length).toBeGreaterThan(0); expect(d.reported).toBe(false); }
      if (d.outcome === "correct-reject") { expect(d.flaggedBy).toEqual([]); expect(d.reported).toBe(false); }
    }
  });
  it("the given hazard is never counted as a prediction on the map", () => {
    const s = scoreByWard(area, res, [inc(1, 85.36)], wards, opt);
    for (const d of s.detail) expect(d.flaggedBy.join()).not.toMatch(/Hazard|GIVEN/);
  });
  it("counts the reports behind each damaged ward", () => {
    const s = scoreByWard(area, res, [inc(1, 85.36), inc(2, 85.36), inc(3, 85.30)], wards, opt);
    const reported = s.detail.filter((d) => d.reported);
    expect(reported.reduce((t, d) => t + d.incidents, 0)).toBe(3);
    expect(Math.max(...reported.map((d) => d.incidents))).toBe(2);
  });
});
