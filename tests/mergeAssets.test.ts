import { describe, expect, it } from "vitest";
import { FixtureSceneAdapter } from "../packages/adapters/fixture/index.ts";
import type { AssetsSnapshot } from "../packages/ports/index.ts";
import { mergeAssetsIntoScene } from "../packages/app/mergeAssets.ts";

describe("mergeAssetsIntoScene", () => {
  it("replaces scene dams/hospitals with OSM assets and keeps closures", () => {
    const scene = new FixtureSceneAdapter().load();
    const mockDamCount = scene.entities.filter((e) => e.kind === "dam").length;
    const mockHospitalCount = scene.entities.filter((e) => e.kind === "hospital").length;
    expect(mockDamCount).toBeGreaterThan(0);

    const assets: AssetsSnapshot = {
      bbox: scene.bbox,
      fetchedAt: new Date().toISOString(),
      source: "openstreetmap-overpass",
      licence: "ODbL",
      cacheHit: false,
      counts: { dam: 1, hospital: 2 },
      assets: [
        { id: "osm/node/10", kind: "dam", name: "Real Dam", at: [85.4, 27.75], geom: { type: "Point", coordinates: [85.4, 27.75] }, tags: { waterway: "dam" }, osmType: "node", osmId: 10 },
        { id: "osm/node/11", kind: "hospital", name: "Real Hospital", at: [85.33, 27.71], geom: { type: "Point", coordinates: [85.33, 27.71] }, tags: { amenity: "hospital" }, osmType: "node", osmId: 11 },
        { id: "osm/node/12", kind: "hospital", name: "Real Clinic", at: [85.34, 27.72], geom: { type: "Point", coordinates: [85.34, 27.72] }, tags: { amenity: "clinic" }, osmType: "node", osmId: 12 },
      ],
    };

    const merged = mergeAssetsIntoScene(scene, assets);
    expect(merged.entities.filter((e) => e.kind === "dam")).toHaveLength(1);
    expect(merged.entities.filter((e) => e.kind === "hospital")).toHaveLength(2);
    expect(merged.entities.filter((e) => e.kind === "closure").length).toBe(scene.entities.filter((e) => e.kind === "closure").length);
    expect(merged.entities.find((e) => e.id === "osm/node/10")?.at).toEqual([85.4, 27.75]);
    expect(merged.geo.points.features.some((f) => f.properties.id === "osm/node/10")).toBe(true);
    expect(merged.advice["osm/node/10"]?.reasons.some((r) => r.input === "Name" && r.text === "Real Dam")).toBe(true);
    expect(mockHospitalCount).not.toBe(2); // scene hospital count differs from OSM merge
  });
});
