import { FixtureSceneAdapter } from "../../packages/adapters/fixture/index.ts";
import { FixtureAtmosphereAdapter, OpenMeteoAtmosphereAdapter } from "../../packages/adapters/openmeteo/atmosphere.ts";
import { FixtureWeatherAdapter, OpenMeteoWeatherAdapter } from "../../packages/adapters/openmeteo/weather.ts";
import { FixtureAssetsAdapter, OverpassAssetsAdapter } from "../../packages/adapters/osm/assets.ts";
import { RunoffFlowAdapter } from "../../packages/adapters/runoff/index.ts";
import { TerrariumTerrainAdapter } from "../../packages/adapters/terrarium/index.ts";
import { CachingTileAdapter } from "../../packages/adapters/tiles/index.ts";
import { createServices, type Services } from "../../packages/app/index.ts";
import type { Container } from "../../packages/ports/index.ts";

export function buildContainer(env: NodeJS.ProcessEnv = process.env): Container {
  const tiles = new CachingTileAdapter();
  const scene = new FixtureSceneAdapter();
  const weatherMode = (env.WEATHER_ADAPTER ?? "openmeteo").toLowerCase();
  const useFixtureWeather = weatherMode === "fixture" || weatherMode === "mock";
  const weather = useFixtureWeather ? new FixtureWeatherAdapter() : new OpenMeteoWeatherAdapter();
  const atmosphere = useFixtureWeather ? new FixtureAtmosphereAdapter() : new OpenMeteoAtmosphereAdapter();
  const assetsMode = (env.ASSETS_ADAPTER ?? "overpass").toLowerCase();
  const useFixtureAssets = assetsMode === "fixture" || assetsMode === "mock";
  const assets = useFixtureAssets ? new FixtureAssetsAdapter(scene) : new OverpassAssetsAdapter();
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
