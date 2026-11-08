# Modular adapters

The ops console backend is hexagonal: **ports** (`packages/ports`) define contracts; **adapters** (`packages/adapters/*`) implement them; **app services** (`packages/app`) orchestrate; **Fastify** (`apps/api`) wires composition and HTTP.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `WEATHER_ADAPTER` | `openmeteo` | `openmeteo` (live Open-Meteo; also selects atmosphere). Offline code path exists for local runs |
| `ASSETS_ADAPTER` | `overpass` | `overpass` (live OSM) or offline OSM scene entities |
| `CESIUM_ION_TOKEN` | (empty) | Optional server-side token for `/api/tiles/cesium` proxy |
| `PORT` | `3001` | API listen port |

## HTTP

- `GET /api/scene` — full ops scene (entities, geo, advice)
- `GET /api/weather/seed` — rainfall inches (Open-Meteo or fallback `10`)
- `GET /api/weather/atmosphere` — Kathmandu cloud cover + MSL pressure isobars / H·L (Open-Meteo grid → GeoJSON). Disk-cached ~1h under `data/cache/weather/`. `?refresh=1` forces refetch. `extensions` reserved for later severe/tornado overlays.
- `GET /api/assets` — OSM hospitals, clinics, schools, dams, airports/helipads, towers, shelters (Kathmandu bbox). Disk-cached 24h under `data/cache/osm/`. `?refresh=1` forces Overpass.
- `GET /api/assessment?rainIn=&stage=` — weather, terrain, depths, runoff image
- `GET /api/tiles/esri/{z}/{y}/{x}` — Esri imagery (disk-cached)
- `GET /api/tiles/terrarium/{z}/{x}/{y}.png` — elevation DEM (disk-cached; shared with terrain agent)
- `GET /api/tiles/cesium?u=<url>` — Cesium ion / Google 3D Tiles proxy (disk-cached)

Cache root: `data/cache/` (gitignored). First request fetches upstream; later hits are local.

## Critical assets adapter

`OverpassAssetsAdapter` queries [Overpass](https://overpass-api.de/) for the valley box `85.284–85.493 × 27.587–27.788`, maps OSM tags → `hospital | school | dam | airport | tower | shelter`, and returns points with names/tags (ODbL). On Overpass failure it serves the last good cache if present.

The web console loads `/api/assets` on startup and **merges** OSM hospitals, schools, dams, airports, towers and shelters into the scene (see `apps/web/src/mergeAssets.ts`), replacing scene pins for those kinds. Closures, QRT, food and social stay on the console scene (cascade + live feeds).

## Swapping an adapter

Edit `apps/api/composition.ts` to swap adapters. Default is live Open-Meteo + Overpass.
