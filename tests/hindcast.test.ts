import { describe, expect, it } from "vitest";
import { buildServer } from "../apps/api/server.ts";
import { HttpError } from "../apps/api/common.ts";
import { assertNetworkPreEvent, HindcastService } from "../apps/api/hindcast.ts";

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
