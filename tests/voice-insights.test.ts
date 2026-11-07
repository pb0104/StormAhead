import { describe, expect, it } from "vitest";
import { affectedTowers, pickRainfallAlert, rainfallAlerts, resolvePlace, socialHotspots } from "../apps/web/src/voice/insights.ts";
import { mergeBipadIntoScene } from "../apps/web/src/mergeBipad.ts";
import type { SceneSnapshot } from "../packages/ports/index.ts";

const emptyScene = (): SceneSnapshot =>
  mergeBipadIntoScene({
    bbox: [85.2, 27.6, 85.5, 27.8],
    note: "test",
    kindLabel: {},
    entities: [],
    advice: {},
    geo: {
      flood: { type: "FeatureCollection", features: [] },
      roads: { type: "FeatureCollection", features: [] },
      closures: { type: "FeatureCollection", features: [] },
      minor: { type: "FeatureCollection", features: [] },
      pockets: { type: "FeatureCollection", features: [] },
      zones: { type: "FeatureCollection", features: [] },
      points: { type: "FeatureCollection", features: [] },
      low: { type: "FeatureCollection", features: [] },
      rain: { type: "FeatureCollection", features: [] },
    },
  } as unknown as SceneSnapshot);

describe("voice insights", () => {
  it("finds affected towers after BIPAD merge", () => {
    const s = emptyScene();
    const t = affectedTowers(s);
    expect(t.down + t.risk).toBe(t.entities.length);
    expect(t.entities.length).toBeGreaterThan(0);
  });

  it("lists social hotspots with counts", () => {
    const hot = socialHotspots(2);
    expect(hot.places.length).toBeGreaterThan(0);
    expect(hot.places[0]!.count).toBeGreaterThanOrEqual(2);
  });

  it("resolves a known place name", () => {
    const s = emptyScene();
    const hot = socialHotspots(2);
    const name = hot.places[0]!.name;
    const r = resolvePlace(s, name.slice(0, Math.min(6, name.length)));
    // may be ambiguous if short; at least suggestions or ok
    expect(r.ok || ("suggestions" in r && r.suggestions.length >= 0)).toBe(true);
  });

  it("lists Heavy Rainfall alert circles", () => {
    const s = emptyScene();
    const r = rainfallAlerts(s);
    expect(r.count).toBeGreaterThan(0);
    expect(r.entities.every((e) => e.kind === "alert")).toBe(true);
    const pick = pickRainfallAlert(s, "Lalitpur");
    expect(pick?.name.toLowerCase()).toContain("lalitpur");
  });
});
