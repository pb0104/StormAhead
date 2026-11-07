import { MockSceneAdapter } from "../../packages/adapters/mock/index.ts";
import { MockAtmosphereAdapter, OpenMeteoAtmosphereAdapter } from "../../packages/adapters/openmeteo/atmosphere.ts";
import { MockWeatherAdapter, OpenMeteoWeatherAdapter } from "../../packages/adapters/openmeteo/weather.ts";
import { MockAssetsAdapter, OverpassAssetsAdapter } from "../../packages/adapters/osm/assets.ts";
import { RunoffFlowAdapter } from "../../packages/adapters/runoff/index.ts";
import { TerrariumTerrainAdapter } from "../../packages/adapters/terrarium/index.ts";
import { CachingTileAdapter } from "../../packages/adapters/tiles/index.ts";
import { createServices, type Services } from "../../packages/app/index.ts";
import type { Container } from "../../packages/ports/index.ts";

export function buildContainer(env: NodeJS.ProcessEnv = process.env): Container {
  const tiles = new CachingTileAdapter();
  const scene = new MockSceneAdapter();
  const weatherMode = (env.WEATHER_ADAPTER ?? "openmeteo").toLowerCase();
  const weather = weatherMode === "mock" ? new MockWeatherAdapter() : new OpenMeteoWeatherAdapter();
  const atmosphere = weatherMode === "mock" ? new MockAtmosphereAdapter() : new OpenMeteoAtmosphereAdapter();
  const assetsMode = (env.ASSETS_ADAPTER ?? "overpass").toLowerCase();
  const assets = assetsMode === "mock" ? new MockAssetsAdapter(scene) : new OverpassAssetsAdapter();
  return {
    scene,
    weather,
    atmosphere,
    terrain: new TerrariumTerrainAdapter(tiles),
    flow: new RunoffFlowAdapter(),
    tiles,
    assets,
  };
}

let services: Services | null = null;
export function getServices(): Services {
  return (services ??= createServices(buildContainer()));
}

/** Test helper: rebuild container (e.g. after env change). */
export function resetServices() {
  services = null;
}
