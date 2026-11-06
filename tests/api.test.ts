import { describe, expect, it } from "vitest";
import { buildServer } from "../apps/api/server.ts";
import { CascadeService } from "../apps/api/service.ts";

const setup = () => { const s = new CascadeService(); return { s, app: buildServer(s) }; };
const post = (app: any, url: string, payload?: any) => app.inject({ method: "POST", url, payload });

describe("API end-to-end workflow", () => {
  it("plan → review → assignments; assignments require approval", async () => {
    const { app } = setup();
    const run = (await post(app, "/api/plan")).json();
    expect(run.status).toBe("proposed");
    expect(run.run.ranked.length).toBeGreaterThan(0);

    // No assignments before review.
    expect((await post(app, `/api/runs/${run.id}/assignments`)).statusCode).toBe(409);
    expect((await app.inject({ url: "/api/inbox" })).json().actions).toHaveLength(0);

    const planId = run.run.ranked[0].plan.id;
    expect((await post(app, `/api/runs/${run.id}/review`, { decision: "approve", reviewer: "Duty Officer" })).statusCode).toBe(400); // no plan chosen
    const ok = await post(app, `/api/runs/${run.id}/review`, { decision: "approve", reviewer: "Duty Officer", planId });
    expect(ok.json().status).toBe("approved");

    const acts = (await post(app, `/api/runs/${run.id}/assignments`)).json().actions;
    expect(acts).toHaveLength(3);
    expect(acts.every((a: any) => a.simulated && a.status === "assigned" && a.reviewer === "Duty Officer")).toBe(true);
    expect((await post(app, `/api/runs/${run.id}/assignments`)).statusCode).toBe(409); // not duplicated
  });

  it("input changes invalidate an approved plan and its assignments", async () => {
    const { app } = setup();
    const run = (await post(app, "/api/plan")).json();
    await post(app, `/api/runs/${run.id}/review`, { decision: "approve", reviewer: "R", planId: run.run.ranked[0].plan.id });
    await post(app, `/api/runs/${run.id}/assignments`);
    const put = await app.inject({ method: "PUT", url: "/api/inputs", payload: { inventory: { inspection: 1, rescue: 1 } } });
    expect(put.json().invalidatedRunIds).toEqual([run.id]);
    const latest = (await app.inject({ url: "/api/runs/latest" })).json().run;
    expect(latest.status).toBe("needs_review");
    expect(latest.stale).toBe(true);
    expect((await app.inject({ url: "/api/inbox" })).json().actions.every((a: any) => a.status === "needs_review")).toBe(true);
    // Cannot re-approve a stale run.
    expect((await post(app, `/api/runs/${run.id}/review`, { decision: "approve", reviewer: "R", planId: run.run.ranked[0].plan.id })).statusCode).toBe(409);
  });

  it("recalculates when a staging site is disabled or a road closed", async () => {
    const { app } = setup();
    await app.inject({ method: "PUT", url: "/api/inputs", payload: { disabledSiteIds: ["ST2"], extraClosureIds: ["R5"] } });
    const run = (await post(app, "/api/plan")).json();
    for (const e of run.run.ranked) expect(e.plan.placements.some((p: any) => p.siteId === "ST2")).toBe(false);
    expect(run.run.access["HZ-LOW"].closedEdgeIds).toEqual(["R5"]);
  });

  it("validates inputs and handles zero inventory", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "PUT", url: "/api/inputs", payload: { disabledSiteIds: ["NOPE"] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/inputs", payload: { inventory: { inspection: -1, rescue: 0 } } })).statusCode).toBe(400);
    await app.inject({ method: "PUT", url: "/api/inputs", payload: { inventory: { inspection: 0, rescue: 0 } } });
    const run = (await post(app, "/api/plan")).json();
    expect(run.brief.headline).toMatch(/No resources are available/);
    expect(run.run.unresolvedInputs.join(" ")).toMatch(/No inspection teams/);
  });

  it("request-revision and reject never create assignments; reset clears state", async () => {
    const { app } = setup();
    const run = (await post(app, "/api/plan")).json();
    expect((await post(app, `/api/runs/${run.id}/review`, { decision: "reject", reviewer: "R" })).json().status).toBe("rejected");
    expect((await post(app, `/api/runs/${run.id}/assignments`)).statusCode).toBe(409);
    await post(app, "/api/reset");
    expect((await app.inject({ url: "/api/runs/latest" })).json().run).toBeNull();
  });

  it("evaluation view is separate and marks post-event sources as not connected", async () => {
    const { app } = setup();
    const ev = (await app.inject({ url: "/api/evaluation" })).json();
    expect(ev.connected).toBe(false);
    expect(ev.evidence.every((e: any) => e.phase === "post-event")).toBe(true);
    const ds = (await app.inject({ url: "/api/dataset" })).json().dataset;
    expect(ds.evidence.some((e: any) => e.phase === "post-event")).toBe(false);
  });
});
