import type { AssessmentResult, AssetsSnapshot, AtmosphereSnapshot, Container, LlmRequest, LlmResult, LlmStatus, SceneSnapshot, WeatherSeed } from "../ports/index.ts";
import { mergeAssetsIntoScene } from "./mergeAssets.ts";

export { mergeAssetsIntoScene } from "./mergeAssets.ts";

export const STAGE_FRACTION: Record<number, number> = { 1: 0.4, 2: 0.75, 3: 1 };

export class SceneService {
  constructor(private c: Container) {}

  /** Mock ops layers plus live OSM critical sites (real dam names, hospitals, etc.). */
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

/**
 * Text generation, with the cost controls in one place rather than at each call site.
 *
 * The rate limit is deliberately crude and in-process: this guards a shared, finite credit balance against a
 * runaway loop in someone's dev server, which is the realistic way the budget gets burned. It is not a
 * security control and does not pretend to be one.
 */
export class LlmService {
  private calls: number[] = [];
  constructor(private c: Container, private perMinute = 20) {}

  status(): Promise<LlmStatus> { return this.c.llm.status(); }

  async generate(req: LlmRequest): Promise<LlmResult> {
    const prompt = (req.prompt ?? "").trim();
    if (!prompt) throw new Error("prompt is required");
    if (prompt.length > 20000) throw new Error("prompt too long (20,000 character limit)");

    const now = Date.now();
    this.calls = this.calls.filter((t) => now - t < 60_000);
    if (this.calls.length >= this.perMinute) {
      throw new Error(`rate limit: ${this.perMinute} generations per minute, to protect a shared credit balance`);
    }
    this.calls.push(now);

    return this.c.llm.generate({ ...req, prompt });
  }
}

export type Services = {
  scene: SceneService;
  weatherSeed: WeatherSeedService;
  atmosphere: AtmosphereService;
  assessment: AssessmentService;
  assets: AssetsService;
  llm: LlmService;
  tiles: Container["tiles"];
};

export function createServices(c: Container): Services {
  return {
    scene: new SceneService(c),
    weatherSeed: new WeatherSeedService(c),
    atmosphere: new AtmosphereService(c),
    assessment: new AssessmentService(c),
    assets: new AssetsService(c),
    llm: new LlmService(c),
    tiles: c.tiles,
  };
}
