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
    focusForecastAgent: vi.fn(() => ({ ok: true })),
    getFocusedAgentBriefing: vi.fn(() => ({ ok: true })),
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
