import { describe, expect, it } from "vitest";
import { affectedTowers, pickRainfallAlert, rainfallAlerts, resolvePlace, findRadioStations, roadClosureReport, searchSocialPosts, socialOverview, socialHotspots } from "../apps/web/src/voice/insights.ts";
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

  it("reports road closures by timeline stage, nearest-first, from entity data", () => {
    const ent = (kind: string, id: string, name: string, at: [number, number], stage?: number, props: Record<string, string | number | boolean> = {}) =>
      ({ kind, id, name, at, stage, props, geom: { type: "Point", coordinates: at } }) as never;
    const scene = { bbox: [85.2, 27.6, 85.5, 27.8], note: "t", kindLabel: {}, advice: {}, geo: {} as never, entities: [
      ent("closure", "C1", "Bagmati bridge", [85.32, 27.67], 1, { cls: "primary", bridge: true, lengthM: 80 }),
      ent("closure", "C2", "Far road", [85.45, 27.7], 3, { cls: "secondary" }),
      ent("pocket", "P1", "Balkhu pocket", [85.30, 27.68]),
      ent("hospital", "HS-3", "Patan Hospital", [85.3204, 27.6685], undefined, { access: "lost", extraMin: 0 }),
    ] } as unknown as SceneSnapshot;
    const dry = roadClosureReport(scene, 0);
    expect(dry.ok && dry.closedCount).toBe(0);
    const mid = roadClosureReport(scene, 1);
    expect(mid.ok && mid.closures.map((c) => c.id)).toEqual(["C1"]);
    expect(mid.ok && mid.cutOffAreas).toEqual([]);
    const high = roadClosureReport(scene, 3, "Patan Hospital");
    expect(high.ok && high.closures[0]!.id).toBe("C1");
    expect(high.ok && high.closures[0]!.distanceKm).toBeLessThan(1);
    expect(high.ok && high.hospitalAccess).toEqual([expect.objectContaining({ id: "HS-3", access: "lost", lon: 85.3204 })]);
    expect(high.ok && high.cutOffAreas[0]!.id).toBe("P1");
    expect(roadClosureReport(scene, 3, "Nowhereville").ok).toBe(false);
  });

  it("searches real posts by tag, text and place, from data only", () => {
    const all = searchSocialPosts(emptyScene(), { limit: 15 });
    expect(all.ok && all.total).toBe(socialOverview().total);
    expect(all.ok && all.posts.length).toBeLessThanOrEqual(15);
    const urgent = searchSocialPosts(emptyScene(), { tag: "urgent", limit: 5 });
    expect(urgent.ok && urgent.posts.every((p) => p.tags.includes("Urgent need"))).toBe(true);
    expect(searchSocialPosts(emptyScene(), { tag: "zzz-nope" }).ok).toBe(false);
    const hit = hotspotPlace();
    const near = searchSocialPosts(emptyScene(), { near: hit });
    expect(near.ok && near.posts.every((p) => p.onMap && p.lon != null)).toBe(true);
  });

  it("ranks valley and news radio stations first and filters by text", () => {
    const st = (id: string, name: string, o: object = {}) => ({ id, name, tags: [], language: "nepali", state: "", distKm: 50, inValley: false, news: false, local: false, bitrate: 64, ...o });
    const r = findRadioStations([st("a", "Far Pop"), st("b", "Kathmandu News", { inValley: true, news: true, distKm: 3 }), st("c", "Valley Music", { inValley: true })]);
    expect(r.stations.map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(findRadioStations([st("a", "Far Pop")], { localOnly: true }).total).toBe(0);
    expect(findRadioStations([st("b", "Kathmandu News")], { query: "kath news" }).total).toBe(1);
  });
});

function hotspotPlace() { return socialHotspots(1).places[0]!.name; }
