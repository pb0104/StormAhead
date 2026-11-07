import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MockAtmosphereAdapter, OpenMeteoAtmosphereAdapter, mockAtmosphereGrid,
} from "../packages/adapters/openmeteo/atmosphere.ts";
import {
  buildAtmosphereLayers, cloudHeatPoints, pressureCenters, pressureIsobars, refineGrid, smoothLine,
} from "../packages/adapters/openmeteo/atmosphereGrid.ts";

describe("atmosphereGrid", () => {
  it("builds weighted cloud points for heatmap", () => {
    const grid = {
      lons: [85.3, 85.33, 85.36],
      lats: [27.65, 27.68, 27.71],
      pressure: [[1010, 1011, 1012], [1011, 1013, 1012], [1010, 1011, 1010]],
      cloud: [[10, 80, 20], [15, 90, 30], [5, 70, 12]],
    };
    const clouds = cloudHeatPoints(grid, 25);
    expect(clouds.features.length).toBe(4);
    expect(clouds.features.every((f) => f.geometry.type === "Point")).toBe(true);
  });

  it("refines grid, smooths isobars, and finds H/L", () => {
    const grid = {
      lons: [0, 1, 2, 3, 4],
      lats: [0, 1, 2, 3, 4],
      pressure: [
        [1000, 1002, 1004, 1002, 1000],
        [1002, 1006, 1010, 1006, 1002],
        [1004, 1010, 1016, 1010, 1004],
        [1002, 1006, 1010, 1006, 1002],
        [1000, 1002, 1004, 1002, 1000],
      ],
      cloud: Array.from({ length: 5 }, () => Array(5).fill(40)),
    };
    const fine = refineGrid(grid, 3);
    expect(fine.lons.length).toBeGreaterThan(grid.lons.length);
    const isobars = pressureIsobars(fine, 2);
    expect(isobars.features.length).toBeGreaterThan(0);
    const longest = isobars.features
      .map((f) => f.geometry)
      .filter((g): g is Extract<typeof g, { type: "LineString" }> => g.type === "LineString")
      .sort((a, b) => b.coordinates.length - a.coordinates.length)[0]!;
    expect(longest.coordinates.length).toBeGreaterThan(4);
    expect(smoothLine([[0, 0], [1, 0], [1, 1]], 2).length).toBeGreaterThan(3);
    const centers = pressureCenters(grid);
    expect(centers.features.some((f) => f.properties.kind === "high")).toBe(true);
    const built = buildAtmosphereLayers(mockAtmosphereGrid());
    expect(built.clouds.features[0]?.geometry.type).toBe("Point");
    expect(built.isobars.type).toBe("FeatureCollection");
  });
});

describe("MockAtmosphereAdapter", () => {
  it("returns clouds and isobars", async () => {
    const snap = await new MockAtmosphereAdapter().load();
    expect(snap.source).toBe("mock");
    expect(snap.clouds.features.length).toBeGreaterThan(0);
    expect(snap.isobars.features.length).toBeGreaterThan(0);
    expect(snap.extensions).toEqual({});
  });
});

describe("OpenMeteoAtmosphereAdapter", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs.length = 0; });

  it("parses multi-point Open-Meteo JSON and caches", async () => {
    const root = mkdtempSync(join(tmpdir(), "ciq-atm-"));
    dirs.push(root);
    const cachePath = join(root, "atm.json");
    let fetches = 0;
    const fetchImpl = async (url: string | URL) => {
      fetches += 1;
      const u = new URL(String(url));
      const lats = u.searchParams.get("latitude")!.split(",").map(Number);
      const lons = u.searchParams.get("longitude")!.split(",").map(Number);
      const body = lats.map((lat, i) => ({
        latitude: lat,
        longitude: lons[i],
        hourly: {
          time: ["2026-11-07T03:00"],
          cloud_cover: [60],
          pressure_msl: [1013 + (i % 5)],
        },
      }));
      return new Response(JSON.stringify(body.length === 1 ? body[0] : body), { status: 200 });
    };
    const a = new OpenMeteoAtmosphereAdapter({
      cachePath,
      fetchImpl: fetchImpl as any,
      maxAgeMs: 60_000,
      step: 0.1,
      bbox: [85.3, 27.65, 85.4, 27.75],
    });
    const first = await a.load({ refresh: true });
    expect(first.cacheHit).toBe(false);
    expect(first.source).toBe("open-meteo-forecast");
    expect(first.clouds.features.length + first.isobars.features.length).toBeGreaterThan(0);
    const second = await a.load();
    expect(second.cacheHit).toBe(true);
    expect(fetches).toBeGreaterThanOrEqual(1);
    expect(fetches).toBe(1); // one chunk for small grid
  });
});
