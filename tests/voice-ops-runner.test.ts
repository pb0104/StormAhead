import { describe, expect, it, vi } from "vitest";
import { runOpsTool } from "../apps/web/src/voice/opsRunner.ts";
import type { OpsHandle } from "../apps/web/src/voice/opsHandle.ts";

function stub(over: Partial<OpsHandle> = {}): OpsHandle {
  return {
    getState: () => ({
      stage: 3, rain: 10, ran: false, busy: false, focus: null, mode: "2d",
      selected: null, vis: {}, doneCount: 0, entityCount: 0,
    }),
    getEntityContext: () => ({ selected: null, reasons: [], actions: [] }),
    setStage: vi.fn(),
    setRain: vi.fn(),
    run: vi.fn(),
    toggle: vi.fn(),
    pick: vi.fn(),
    selectByQuery: () => ({ ok: false, error: "no" }),
    setMode: vi.fn(),
    startFly: vi.fn(),
    openPhoto: vi.fn(),
    applyDone: vi.fn(() => ({ ok: true, simulated: true as const })),
    undoDone: vi.fn(() => ({ ok: true })),
    setAlertPreview: vi.fn(),
    ensureLayer: vi.fn(),
    setInsight: vi.fn(),
    flyBounds: vi.fn(),
    showHighRainfall: vi.fn(() => ({ ok: true })),
    showAffectedTowers: vi.fn(() => ({ ok: true })),
    showSocialHotspots: vi.fn(() => ({ ok: true })),
    flyToPlace: vi.fn(() => ({ ok: true })),
    clearInsights: vi.fn(() => ({ ok: true })),
    askStormAhead: vi.fn(async () => ({ ok: true })),
    deployAgents: vi.fn(() => ({ ok: true })),
    excludeAgents: vi.fn(() => ({ ok: true, removed: [], picked: [] })),
    includeAgents: vi.fn(() => ({ ok: true, added: [], picked: [] })),
    getOracleContext: vi.fn(() => ({ ok: true, agents: [] })),
    listActions: vi.fn(() => ({ ok: true, actions: [] })),
    logAction: vi.fn(async () => ({ ok: true, pending: true })),
    confirmActionUpdate: vi.fn(async () => ({ ok: true })),
    cancelActionUpdate: vi.fn(() => ({ ok: true })),
    editAction: vi.fn(async () => ({ ok: true })),
    removeAction: vi.fn(async () => ({ ok: true })),
    ...over,
  };
}

describe("ask_stormahead tool", () => {
  it("forwards the question to askStormAhead", async () => {
    const h = stub();
    const r = await runOpsTool(h, "ask_stormahead", { question: "How do the next 15 days look?" });
    expect(r.ok).toBe(true);
    expect(h.askStormAhead).toHaveBeenCalledWith("How do the next 15 days look?");
  });
});

describe("get_oracle_context tool", () => {
  it("returns the full intel snapshot", async () => {
    const h = stub({
      getOracleContext: vi.fn(() => ({ ok: true, agents: [{ id: "weather", headline: "rain" }], phase: "done" })),
    });
    const r = await runOpsTool(h, "get_oracle_context", {});
    expect(r.ok).toBe(true);
    expect(h.getOracleContext).toHaveBeenCalled();
    expect(r.agents).toEqual([{ id: "weather", headline: "rain" }]);
  });
});

describe("runOpsTool", () => {
  it("refuses apply_response without confirmed", async () => {
    const h = stub();
    const r = await runOpsTool(h, "apply_response", { actionId: "a1", mode: "assigned", confirmed: false });
    expect(r.ok).toBe(false);
    expect(h.applyDone).not.toHaveBeenCalled();
  });

  it("applies when confirmed", async () => {
    const h = stub();
    const r = await runOpsTool(h, "apply_response", { actionId: "a1", mode: "assigned", confirmed: true });
    expect(r.ok).toBe(true);
    expect(h.applyDone).toHaveBeenCalledWith("a1", "assigned");
  });
});

describe("ORACLE action tools", () => {
  it("logs an update for confirmation, and only saves when the operator confirmed", async () => {
    const h = stub();
    expect((await runOpsTool(h, "log_action", { text: "Sent QRT-2 to Balkhu" })).ok).toBe(true);
    expect(h.logAction).toHaveBeenCalledWith("Sent QRT-2 to Balkhu");
    expect((await runOpsTool(h, "confirm_action_update", {})).ok).toBe(false);
    expect(h.confirmActionUpdate).not.toHaveBeenCalled();
    expect((await runOpsTool(h, "confirm_action_update", { confirmed: true })).ok).toBe(true);
  });
  it("maps edit fields and refuses an empty edit", async () => {
    const h = stub();
    await runOpsTool(h, "edit_action", { id: "a1", people: 60, place: "Kalimati open space" });
    expect(h.editAction).toHaveBeenCalledWith("a1", { people: 60, placeText: "Kalimati open space" });
    expect((await runOpsTool(h, "edit_action", { id: "a1" })).ok).toBe(false);
  });
  it("removes only with confirmation", async () => {
    const h = stub();
    expect((await runOpsTool(h, "remove_action", { id: "a1" })).ok).toBe(false);
    expect(h.removeAction).not.toHaveBeenCalled();
    await runOpsTool(h, "remove_action", { id: "a1", confirmed: true });
    expect(h.removeAction).toHaveBeenCalledWith("a1");
  });
});
