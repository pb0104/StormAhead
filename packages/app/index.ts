import type { AssessmentResult, AssetsSnapshot, AtmosphereSnapshot, Container, SceneSnapshot, WeatherSeed } from "../ports/index.ts";
import { mergeAssetsIntoScene } from "./mergeAssets.ts";

export { mergeAssetsIntoScene } from "./mergeAssets.ts";

export const STAGE_FRACTION: Record<number, number> = { 1: 0.4, 2: 0.75, 3: 1 };

export class SceneService {
  constructor(private c: Container) {}

  /** Live ops scene plus OSM critical sites (dams, hospitals, schools, etc.). */
  async load(): Promise<SceneSnapshot> {
    const scene = this.c.scene.load();
    try {
      const assets = await this.c.assets.load();
      return mergeAssetsIntoScene(scene, assets);
    } catch {
      return scene;
    }
  }
}

export class WeatherSeedService {
  constructor(private c: Container) {}
  seed(): Promise<WeatherSeed> { return this.c.weather.seedRainfall(); }
}

export class AtmosphereService {
  constructor(private c: Container) {}
  load(opts?: { refresh?: boolean }): Promise<AtmosphereSnapshot> {
    return this.c.atmosphere.load(opts);
  }
}

export class AssetsService {
  constructor(private c: Container) {}
  load(opts?: { refresh?: boolean }): Promise<AssetsSnapshot> {
    return this.c.assets.load(opts);
  }
}

export class AssessmentService {
  private terrainPromise: ReturnType<Container["terrain"]["assess"]> | null = null;

  constructor(private c: Container) {}

  private terrain() {
    return (this.terrainPromise ??= this.c.terrain.assess());
  }

  async run(rainIn: number, stage: number): Promise<AssessmentResult> {
    const scene = this.c.scene.load();
    const frac = STAGE_FRACTION[stage] ?? 1;
    const weather = this.c.weather.describe(rainIn);
    const terrain = await this.terrain();
    const mmRain = rainIn * 25.4 * frac;
    const flowed = await this.c.flow.run({
      grid: terrain.grid ?? { w: 0, h: 0, lon0: 0, lon1: 0, lat0: 0, lat1: 0, cellM: 70, z: [] },
      mmRain,
      depth0: terrain.depth0,
      inches: rainIn,
      stageFraction: frac,
      floodPolys: scene.floodPolys,
    });
    const flowText = !terrain.grid
      ? "Flow agent needs the elevation grid, which could not be built."
      : !flowed.flow
        ? "Flow agent: run the assessment to route the rain downhill."
        : `Flow agent: water drains off slopes and pools in about ${flowed.flow.pooledKm2.toFixed(1)} km² of low ground, typically about ${flowed.flow.maxDepth.toFixed(1)} m deep.`;
    return {
      weather,
      terrain,
      depths: flowed.depths,
      floodFc: flowed.floodFc,
      flow: flowed.flow,
      flowText,
      wet: flowed.wet,
      deepest: flowed.deepest,
      stageFraction: frac,
    };
  }
}

export type Services = {
  scene: SceneService;
  weatherSeed: WeatherSeedService;
  atmosphere: AtmosphereService;
  assessment: AssessmentService;
  assets: AssetsService;
  tiles: Container["tiles"];
};

export function createServices(c: Container): Services {
  return {
    scene: new SceneService(c),
    weatherSeed: new WeatherSeedService(c),
    atmosphere: new AtmosphereService(c),
    assessment: new AssessmentService(c),
    assets: new AssetsService(c),
    tiles: c.tiles,
  };
}
