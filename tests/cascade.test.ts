import { describe, expect, it } from "vitest";
import { analyzeCascade, DEFAULT_PARAMS, DEFAULT_SCORE, multiSourceDijkstra, scoreAgainstIncidents, type Incident, type RealArea, type RealEdge } from "../packages/analysis/cascade.ts";

const E = (u: number, v: number, minutes: number, extra: Partial<RealEdge> = {}): RealEdge => ({
  u, v, minutes, lengthM: minutes * 300, cls: "residential", bridge: false, floodedShare: 0, name: null, osmWayId: u * 100 + v,
  mid: [85.3 + (u + v) * 0.005, 27.7], distFloodM: 5000, via: null, ...extra,
});
const P = (id: number, node: number, extra = {}) => ({ id, name: `P${id}`, lon: 85.3 + node * 0.01, lat: 27.7, node, inFlood: false, distFloodM: 3000, ...extra });

// Left chain 0-1-2-3-4-5 (6 nodes), flooded bridge 5-6, right chain 6-7-8. Hospital at node 0.
const nodes = Array.from({ length: 9 }, (_, i) => [85.3 + i * 0.01, 27.7] as [number, number]);
const chain = () => [E(0, 1, 2), E(1, 2, 2), E(2, 3, 2), E(3, 4, 2), E(4, 5, 2), E(5, 6, 2, { bridge: true, floodedShare: 0.2 }), E(6, 7, 2), E(7, 8, 2)];
const area = (over: Partial<RealArea> = {}): RealArea => ({
  nodes, edges: chain(),
  places: [P(1, 2), P(2, 7), P(3, 8), P(4, 5, { inFlood: true, distFloodM: 0 })],
  hospitals: [P(100, 0)], ...over,
});

describe("heap Dijkstra", () => {
  it("matches hand-computed multi-source distances and marks unreachable as Infinity", () => {
    const adj = [[{ to: 1, w: 4 }, { to: 2, w: 1 }], [{ to: 0, w: 4 }, { to: 2, w: 2 }], [{ to: 0, w: 1 }, { to: 1, w: 2 }], []];
    const d = multiSourceDijkstra(adj, [0]);
    expect([...d]).toEqual([0, 3, 1, Infinity]);
    expect([...multiSourceDijkstra(adj, [0, 1])]).toEqual([0, 0, 1, Infinity]);
  });
});

describe("cascade analysis", () => {
  it("a flooded bridge isolates the dry far side: cascade, not direct", () => {
    const r = analyzeCascade(area());
    const st = (i: number) => r.places[i]!.status;
    expect(st(0)).toBe("unaffected");
    expect(st(1)).toBe("cascade-isolated");
    expect(st(2)).toBe("cascade-isolated");
    expect(st(3)).toBe("direct");
    expect(r.places[1]!.t0).toBe(14); // baseline time exists…
    expect(r.places[1]!.t1).toBeNull(); // …but no finite time under closure
    expect(r.counts.closedBridges).toBe(1);
  });
  it("exposed is not closed: a low-share non-bridge road stays open", () => {
    const a = area({ edges: chain().map((e) => (e.bridge ? e : e.u === 2 ? { ...e, floodedShare: 0.1 } : e)) });
    const r = analyzeCascade(a);
    expect(r.exposedEdges).toHaveLength(2);
    expect(r.closedEdges).toHaveLength(1);
    expect(analyzeCascade(a, { ...DEFAULT_PARAMS, closeShare: 0.05 }).closedEdges).toHaveLength(2); // threshold matters
  });
  it("stranded edges are dry, open and cut off from the main network", () => {
    const r = analyzeCascade(area());
    const a = area();
    expect(r.strandedEdges.map((i) => [a.edges[i]!.u, a.edges[i]!.v])).toEqual([[6, 7], [7, 8]]);
  });
  it("a detour turns isolation into degradation", () => {
    const a = area({ edges: [...chain(), E(4, 7, 60)] });
    const r = analyzeCascade(a);
    expect(r.places[1]!.status).toBe("cascade-degraded");
    expect(r.places[1]!.t1).toBe(8 + 60);
    expect(r.strandedEdges).toHaveLength(0);
  });
  it("a flooded hospital is unavailable, so dry places lose access (cascade)", () => {
    const r = analyzeCascade(area({ hospitals: [P(100, 0, { inFlood: true, distFloodM: 0 })] }));
    expect(r.places.filter((p) => p.status === "cascade-isolated")).toHaveLength(3);
    expect(r.counts.hospitalsFlooded).toBe(1);
  });
  it("places with no baseline hospital access are not reported as cascade", () => {
    const a = area({ edges: chain().slice(0, 5), places: [P(9, 8)] }); // node 8 never connected
    expect(analyzeCascade(a).places[0]!.status).toBe("no-baseline");
  });
  it("is independent of incident data (no incident input exists)", () => {
    expect(analyzeCascade.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(analyzeCascade(area()))).toEqual(JSON.stringify(analyzeCascade(area())));
  });
});

describe("scoring against incident reports", () => {
  const inc = (id: number, over: Partial<Incident>): Incident => ({
    id, title: `I${id}`, lon: 85.3 + 7 * 0.01, lat: 27.7, hazard: "Flood", floodRelated: true, hasImpact: true, distFloodM: 800, incidentOn: "2024-09-28", loss: {}, ...over,
  });
  const a = area();
  const r = analyzeCascade(a);
  it("counts only primary-hazard, impactful incidents; splits in-flood vs outside", () => {
    const s = scoreAgainstIncidents(a, r, [
      inc(1, {}),                                   // outside flood, right next to flagged place P2 (node 7) → covered
      inc(2, { lon: 85.5, lat: 27.9 }),             // outside flood, nowhere near → not covered
      inc(3, { distFloodM: 0 }),                    // in flood
      inc(4, { hazard: "Landslide" }),              // not primary
      inc(5, { hasImpact: false }),                 // no impact reported
      inc(6, { floodRelated: false, hazard: "Fire" }),
    ], { ...DEFAULT_SCORE, permutations: 200 });
    expect(s.evaluated).toBe(3);
    expect(s.inFlood).toBe(1);
    expect(s.outsideFlood).toBe(2);
    expect(s.outsideCovered).toBe(1);
    expect(s.outsideRecall).toBe(0.5);
    expect(s.randomBaseline.p).toBeGreaterThan(0);
    expect(s.randomBaseline.p).toBeLessThanOrEqual(1);
    expect(s.incidents.find((i) => i.id === 2)!.coveredByCascade).toBe(false);
    expect(s.incidents.find((i) => i.id === 3)!.coveredByCascade).toBeNull();
  });
  it("is reproducible for a fixed seed and reports null recall with no outside incidents", () => {
    const list = [inc(1, {}), inc(2, { lon: 85.5, lat: 27.9 })];
    const s1 = scoreAgainstIncidents(a, r, list, { ...DEFAULT_SCORE, permutations: 100 });
    const s2 = scoreAgainstIncidents(a, r, list, { ...DEFAULT_SCORE, permutations: 100 });
    expect(s1.randomBaseline).toEqual(s2.randomBaseline);
    expect(scoreAgainstIncidents(a, r, [], DEFAULT_SCORE).outsideRecall).toBeNull();
  });
});
