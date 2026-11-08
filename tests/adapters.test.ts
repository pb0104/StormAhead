import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixtureSceneAdapter } from "../packages/adapters/fixture/index.ts";
import { clampInches, describeWeather, FixtureWeatherAdapter, OpenMeteoWeatherAdapter } from "../packages/adapters/openmeteo/weather.ts";
import { DiskTileCache } from "../packages/adapters/tiles/diskCache.ts";
import { CachingTileAdapter } from "../packages/adapters/tiles/index.ts";
import { floodDepths } from "../packages/adapters/runoff/index.ts";

describe("FixtureSceneAdapter", () => {
  it("returns stable entity counts and advice", () => {
    const s = new FixtureSceneAdapter().load();
    expect(s.entities.length).toBeGreaterThan(50);
    expect(s.entities.filter((e) => e.kind === "closure").length).toBeGreaterThan(5);
    expect(s.entities.filter((e) => e.kind === "hospital").length).toBe(6);
    expect(s.geo.roads.features.length).toBeGreaterThan(10);
    const first = s.entities[0]!;
    expect(s.advice[first.id]?.reasons.length).toBeGreaterThan(0);
  });
});

describe("weather", () => {
  it("clamps inches to slider range", () => {
    expect(clampInches(1)).toBe(4);
    expect(clampInches(25)).toBe(20);
    expect(clampInches(10.4)).toBe(10);
  });

  it("describeWeather matches prior labels", () => {
    expect(describeWeather(10).label).toBe("Heavy");
    expect(describeWeather(15).label).toBe("Extreme");
  });

  it("OpenMeteo falls back to 10 on fetch failure", async () => {
    const w = new OpenMeteoWeatherAdapter(async () => { throw new Error("offline"); });
    const seed = await w.seedRainfall();
    expect(seed.inches).toBe(10);
    expect(seed.source).toBe("fallback-default");
  });

  it("OpenMeteo maps precip mm to inches", async () => {
    const w = new OpenMeteoWeatherAdapter(async (url) => {
      if (String(url).includes("flood-api")) {
        return new Response(JSON.stringify({ daily: { river_discharge: [100] } }), { status: 200 });
      }
      return new Response(JSON.stringify({
        hourly: { precipitation: Array.from({ length: 24 }, () => 10) }, // 240 mm
      }), { status: 200 });
    });
    const seed = await w.seedRainfall();
    expect(seed.inches).toBe(clampInches(240 / 25.4));
    expect(seed.source).toBe("open-meteo-forecast");
  });

  it("FixtureWeatherAdapter returns fixed inches", async () => {
    expect((await new FixtureWeatherAdapter(12).seedRainfall()).inches).toBe(12);
  });
});

describe("floodDepths", () => {
  it("scales with rain and zeros shallow patches", () => {
    const d = floodDepths([2.4, 0.05], 10, 1, 2);
    expect(d[0]).toBeCloseTo(2.4);
    expect(d[1]).toBe(0);
  });
});

describe("DiskTileCache", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs.length = 0; });

  it("fetches once then serves from disk", async () => {
    const root = mkdtempSync(join(tmpdir(), "ciq-tiles-"));
    dirs.push(root);
    let fetches = 0;
    const fetchImpl = async () => {
      fetches += 1;
      return new Response(Buffer.from("png-bytes"), { status: 200, headers: { "content-type": "image/png" } });
    };
    const cache = new DiskTileCache(root, fetchImpl as any);
    const a = await cache.get("terrarium", "13/1/2.png", "https://example.test/13/1/2.png");
    const b = await cache.get("terrarium", "13/1/2.png", "https://example.test/13/1/2.png");
    expect(a.cacheHit).toBe(false);
    expect(b.cacheHit).toBe(true);
    expect(fetches).toBe(1);
    expect(cache.fetchCount).toBe(1);
    expect(a.body.equals(b.body)).toBe(true);

    const cold = new DiskTileCache(root, fetchImpl as any);
    const c = await cold.get("terrarium", "13/1/2.png", "https://example.test/13/1/2.png");
    expect(c.cacheHit).toBe(true);
    expect(fetches).toBe(1);
  });

  it("CachingTileAdapter esri path uses cache", async () => {
    const root = mkdtempSync(join(tmpdir(), "ciq-esri-"));
    dirs.push(root);
    let fetches = 0;
    const fetchImpl = async () => {
      fetches += 1;
      return new Response(Buffer.from("jpg"), { status: 200, headers: { "content-type": "image/jpeg" } });
    };
    const tiles = new CachingTileAdapter(new DiskTileCache(root, fetchImpl as any));
    await tiles.getEsri(10, 1, 2);
    await tiles.getEsri(10, 1, 2);
    expect(fetches).toBe(1);
  });
});
