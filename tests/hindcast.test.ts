import { describe, expect, it } from "vitest";
import { buildServer } from "../apps/api/server.ts";
import { HttpError } from "../apps/api/common.ts";
import { assertBuildingsPreEvent, assertNetworkPreEvent, HindcastService } from "../apps/api/hindcast.ts";

const have = HindcastService.available();
const d = describe.skipIf(!have);

describe("temporal guard for the real network", () => {
  const prov = (snapshot: string, phase = "pre-event") => ({ network: { snapshot, phase } }) as any;
  it("accepts a pre-event snapshot and rejects a post-event or same-day one", () => {
    expect(() => assertNetworkPreEvent(prov("2024-01-02"))).not.toThrow();
    expect(() => assertNetworkPreEvent(prov("2026-11-06"))).toThrow(HttpError);
    expect(() => assertNetworkPreEvent(prov("2024-09-27"))).toThrow(/Temporal separation/);
    expect(() => assertNetworkPreEvent(prov("2024-01-02", "post-event"))).toThrow();
  });
  it("holds the building layer to the same pre-event rule", () => {
    expect(() => assertBuildingsPreEvent({ snapshot: "2024-01-02", phase: "pre-event" })).not.toThrow();
    expect(() => assertBuildingsPreEvent({ snapshot: "2024-10-01", phase: "pre-event" })).toThrow(/Temporal separation/);
    expect(() => assertBuildingsPreEvent({ snapshot: "2024-01-02", phase: "post-event" })).toThrow(HttpError);
  });
});

d("Kathmandu hindcast on the real dataset", () => {
  const h = new HindcastService();
  it("loads a pre-event network whose snapshot precedes the event", () => {
    expect(h.prov.network.snapshot).toBe("2024-01-02");
    expect(h.area.edges.length).toBe(h.prov.counts.edges);
    expect(h.area.places.length).toBe(h.prov.counts.places);
  });
  it("closed edges are always exposed; stranded edges are always dry; exposed ≠ closed", () => {
    const r = h.run().result;
    expect(r.closedEdges.every((i) => h.area.edges[i]!.floodedShare > 0)).toBe(true);
    expect(r.strandedEdges.every((i) => h.area.edges[i]!.floodedShare === 0)).toBe(true);
    expect(r.closedEdges.length).toBeLessThan(r.exposedEdges.length);
    expect(r.closedEdges.length).toBeGreaterThan(0);
  });
  it("stricter closure thresholds never close more roads", () => {
    const n = (cs: number) => h.run({ closeShare: cs, bridgeClosesOnAnyContact: false }).result.counts.closedEdges!;
    expect(n(0.1)).toBeGreaterThanOrEqual(n(0.5));
    expect(n(0.5)).toBeGreaterThanOrEqual(n(0.8));
  });
  it("is deterministic", () => {
    const a = h.run(), b = h.run();
    expect(a.result).toEqual(b.result);
    expect(a.score).toEqual(b.score);
  });
  it("the prediction does not depend on incident reports (they are only used for scoring)", () => {
    const withInc = h.run().result;
    const saved = h.incidents; h.incidents = [];
    const without = h.run().result;
    h.incidents = saved;
    expect(without).toEqual(withInc);
  });
  it("scores only declared primary hazards; landslides/fire are excluded from the headline", () => {
    const s = h.run().score;
    expect(s.incidents.every((i) => ["Flood", "Inundation", "Heavy Rainfall"].includes(i.hazard))).toBe(true);
    expect(s.evaluated).toBe(s.inFlood + s.outsideFlood);
  });
  it("logs agent events in order, scoring last and after prediction", () => {
    const tools = h.run().events.map((e) => e.tool);
    expect(tools.indexOf("analyzeCascade")).toBeLessThan(tools.indexOf("scoreAgainstIncidents"));
    expect(tools[0]).toBe("assertNetworkPreEvent");
  });
  it("rejects invalid parameters", () => {
    expect(() => h.run({ closeShare: 0 })).toThrow(HttpError);
    expect(() => h.run({ degradeRatio: 0.5 })).toThrow(/Invalid/);
  });
  it("serves through the API", async () => {
    const app = buildServer();
    expect((await app.inject({ url: "/api/hindcast/meta" })).json().available).toBe(true);
    const run = (await app.inject({ method: "POST", url: "/api/hindcast/run", payload: { closeShare: 0.3 } })).json();
    expect(run.result.counts.places).toBe(h.prov.counts.places);
    expect(run.score.options.primaryHazards).toContain("Flood");
    expect(run.radiusSensitivity).toHaveLength(3);
    expect((await app.inject({ method: "POST", url: "/api/hindcast/run", payload: { closeShare: 5 } })).statusCode).toBe(400);
  });
});

d("buildings as shelter targets on the real dataset", () => {
  const h = new HindcastService();
  const has = !!h.area.buildings?.length;
  it.skipIf(!has)("loads pre-event footprints and never guesses an untagged height", () => {
    const bs = h.area.buildings!;
    expect(h.buildingsMeta!.snapshot).toBe("2024-01-02");
    expect(bs.every((b) => b.lon > 85.2 && b.lon < 85.5 && b.lat > 27.5 && b.lat < 27.8)).toBe(true);
    expect(bs.every((b) => b.floors === null || (b.floors >= 1 && b.floors <= 60))).toBe(true);
    const r = h.run().result;
    const unknown = r.buildings.filter((b) => b.role === "unknown-height");
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown.every((b) => b.f === null && b.cap === null)).toBe(true);
  });
  it.skipIf(!has)("only flooded buildings are told to shelter or evacuate", () => {
    const bs = h.area.buildings!, r = h.run().result;
    for (const b of r.buildings) {
      if (b.role === "at-risk-vertical" || b.role === "at-risk-evacuate") expect(bs[b.i]!.inFlood).toBe(true);
      if (b.role === "refuge") expect(bs[b.i]!.inFlood).toBe(false);
    }
  });
  it.skipIf(!has)("reports building-target scoring alongside the primary headline, not instead of it", () => {
    const run = h.run();
    expect(run.score.flagged.buildings).toBe(0);              // primary target set unchanged
    expect(run.buildingTargets!.buildingsOnly.flagged.edges).toBe(0);
    expect(run.buildingTargets!.withBuildings.flagged.buildings).toBeGreaterThan(0);
  });
});
