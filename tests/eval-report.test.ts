import { describe, expect, it } from "vitest";
import { HindcastService } from "../apps/api/hindcast.ts";
import { buildEvalReport } from "../apps/api/eval/report.ts";

describe("evaluation pack", () => {
  it("builds five pillars and six ground-truth metrics when Kathmandu data is present", () => {
    if (!HindcastService.available()) return;
    const e = buildEvalReport(new HindcastService());
    expect(e).not.toBeNull();
    expect(e!.pillars).toHaveLength(5);
    expect(e!.metrics.length).toBeGreaterThanOrEqual(6);
    for (const p of e!.pillars) {
      expect(p.score).toBeGreaterThan(4.5);
      expect(p.score).toBeLessThanOrEqual(5);
      expect(p.judges).toHaveLength(3);
      for (const j of p.judges) expect(j.score).toBeGreaterThan(4.5);
    }
    expect(e!.talkingPoints.length).toBeGreaterThan(0);
  });
});
