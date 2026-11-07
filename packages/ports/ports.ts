import type {
  AssessmentResult, AssetsSnapshot, AtmosphereSnapshot, SceneSnapshot, TileBytes, Weather, WeatherSeed,
} from "./types.ts";

export interface ScenePort {
  load(): SceneSnapshot;
}

export interface WeatherPort {
  /** Seed rainfall inches for the valley (clamped by the service). */
  seedRainfall(): Promise<WeatherSeed>;
  /** Derive display weather from inches (pure). */
  describe(inches: number): Weather;
}

export interface TerrainPort {
  /** Build terrain depth ranking + elevation grid for the valley. Uses shared tile cache. */
  assess(): Promise<import("./types.ts").TerrainResult>;
}

export interface FlowPort {
  run(opts: {
    grid: import("./types.ts").Grid;
    mmRain: number;
    depth0: number[];
    inches: number;
    stageFraction: number;
    floodPolys: import("./types.ts").FloodPoly[];
  }): Promise<{
    depths: number[];
    floodFc: import("./types.ts").FeatureCollection;
    flow: AssessmentResult["flow"];
    wet: number;
    deepest: number;
  }>;
}

export interface TileCachePort {
  getEsri(z: number, y: number, x: number): Promise<TileBytes>;
  getTerrarium(z: number, x: number, y: number): Promise<TileBytes>;
  /** Proxy arbitrary Cesium ion / Google 3D Tiles URL path+query; cache by key. */
  getCesium(upstreamUrl: string, cacheKey: string, headers?: Record<string, string>): Promise<TileBytes>;
}

export interface AdvicePort {
  forEntity(entityId: string, scene: SceneSnapshot): { reasons: import("./types.ts").Reason[]; actions: import("./types.ts").Action[] };
}

/** Fetch accurate hospital / dam / school / airport / tower / shelter locations (OSM). */
export interface AssetsPort {
  load(opts?: { refresh?: boolean }): Promise<AssetsSnapshot>;
}

/** Cloud cover + MSL pressure bands for the valley map. */
export interface AtmospherePort {
  load(opts?: { refresh?: boolean }): Promise<AtmosphereSnapshot>;
}

export type Container = {
  scene: ScenePort;
  weather: WeatherPort;
  terrain: TerrainPort;
  flow: FlowPort;
  tiles: TileCachePort;
  assets: AssetsPort;
  atmosphere: AtmospherePort;
};
