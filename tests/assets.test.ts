import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FixtureSceneAdapter } from "../packages/adapters/fixture/index.ts";
import { enrichDamNames, FixtureAssetsAdapter, OverpassAssetsAdapter } from "../packages/adapters/osm/assets.ts";

describe("enrichDamNames", () => {
  it("labels unnamed dams from nearby named water", () => {
    const assets = [{
      id: "osm/way/1", kind: "dam" as const, name: "Unnamed Dam (OSM 1)", at: [85.48, 27.70] as [number, number],
      geom: { type: "Point" as const, coordinates: [85.48, 27.70] as [number, number] },
      tags: { waterway: "dam" }, osmType: "way" as const, osmId: 1,
    }];
    const elements = [
      { type: "way" as const, id: 2, center: { lat: 27.7005, lon: 85.4805 }, tags: { natural: "water", name: "Muhan Pokhari" } },
    ];
    expect(enrichDamNames(assets, elements)[0]!.name).toBe("Muhan Pokhari dam");
  });
});

describe("FixtureAssetsAdapter", () => {
  it("projects hospital/dam/school entities from the OSM scene", async () => {
    const snap = await new FixtureAssetsAdapter(new FixtureSceneAdapter()).load();
    expect(snap.source).toBe("osm-scene");
    expect((snap.counts.hospital ?? 0)).toBeGreaterThan(0);
    expect((snap.counts.dam ?? 0)).toBeGreaterThan(0);
    expect(snap.assets.every((a) => a.at.length === 2)).toBe(true);
  });
});

describe("OverpassAssetsAdapter", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs.length = 0; });

  it("parses Overpass JSON into typed assets and caches to disk", async () => {
    const root = mkdtempSync(join(tmpdir(), "ciq-osm-"));
    dirs.push(root);
    const cachePath = join(root, "assets.json");
    let fetches = 0;
    const fetchImpl = async () => {
      fetches += 1;
      return new Response(JSON.stringify({
        elements: [
          { type: "node", id: 1, lat: 27.7, lon: 85.32, tags: { amenity: "hospital", name: "Test Hospital" } },
          { type: "node", id: 2, lat: 27.71, lon: 85.33, tags: { amenity: "school", name: "Test School" } },
          { type: "way", id: 3, center: { lat: 27.72, lon: 85.34 }, tags: { waterway: "dam", name: "Test Dam" } },
          { type: "node", id: 4, lat: 27.69, lon: 85.35, tags: { man_made: "mast", name: "Tower A" } },
          { type: "node", id: 5, lat: 27.7, lon: 85.36, tags: { aeroway: "aerodrome", name: "Test Airport" } },
          { type: "node", id: 6, lat: 27.71, lon: 85.37, tags: { aeroway: "helipad", name: "Test Helipad" } },
          { type: "node", id: 99, lat: 27.7, lon: 85.3, tags: { amenity: "cafe" } },
        ],
      }), { status: 200 });
    };
    const a = new OverpassAssetsAdapter({ cachePath, fetchImpl: fetchImpl as any, maxAgeMs: 60_000 });
    const first = await a.load({ refresh: true });
    expect(first.cacheHit).toBe(false);
    expect(first.assets).toHaveLength(6);
    expect(first.counts).toEqual({ hospital: 1, school: 1, dam: 1, tower: 1, airport: 1, helipad: 1 });
    expect(first.assets.find((a) => a.kind === "dam")?.name).toBe("Test Dam");
    expect(first.assets.find((a) => a.kind === "airport")?.name).toBe("Test Airport");
    expect(first.assets.find((a) => a.kind === "helipad")?.name).toBe("Test Helipad");
    expect(first.licence).toContain("ODbL");

    const second = await a.load();
    expect(second.cacheHit).toBe(true);
    expect(fetches).toBe(1);
  });

  it("falls back to stale cache when Overpass fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "ciq-osm-fail-"));
    dirs.push(root);
    const cachePath = join(root, "assets.json");
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      if (n === 1) {
        return new Response(JSON.stringify({
          elements: [{ type: "node", id: 1, lat: 27.7, lon: 85.32, tags: { amenity: "hospital", name: "H" } }],
        }), { status: 200 });
      }
      return new Response("busy", { status: 504 });
    };
    const a = new OverpassAssetsAdapter({ cachePath, fetchImpl: fetchImpl as any, maxAgeMs: 1 });
    await a.load({ refresh: true });
    await new Promise((r) => setTimeout(r, 5));
    const stale = await a.load({ refresh: true });
    expect(stale.assets).toHaveLength(1);
    expect(stale.source).toContain("stale-fallback");
  });
});
