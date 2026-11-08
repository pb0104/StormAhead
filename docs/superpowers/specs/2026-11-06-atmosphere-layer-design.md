# Atmosphere layer (Kathmandu) — design

**Date:** 2026-11-06 
**Status:** Draft for review 
**Scope:** Cloud coverage + mean-sea-level pressure bands on the CascadeIQ ops map, Kathmandu valley only. Stubbed for later tornado / severe overlays.

## Goals

- Show soft cloud cover and classic pressure isobars with H/L labels on the 2D map.
- Fetch and cache on the **server** (same pattern as OSM assets / tile proxy), not in the browser.
- Keep the UI visually consistent: one Live feeds chip, MapLibre layers, no new visual language.
- Leave an extension point for future US tornado / severe products without reshaping the API.

## Non-goals (v1)

- Tornado tracks, NWS/SPC alerts, or US coverage.
- Photoreal / Cesium atmosphere.
- Animated radar loops or multi-hour scrubbing (single forecast hour is enough).
- Client-side Open-Meteo calls.

## Architecture

```
Open-Meteo Forecast API
 │
 ▼
OpenMeteoAtmosphereAdapter ──disk──► data/cache/weather/atmosphere-ktm.json
 │
 ▼
WeatherAtmosphereService / GET /api/weather/atmosphere
 │
 ▼
Web: ops.atmosphere() → MapStage layers (Atmosphere toggle)
```

### Ports

- Extend or add `WeatherAtmospherePort` next to existing `WeatherPort` (rainfall seed stays separate).
- Method: `load(opts?: { refresh?: boolean }): Promise<AtmosphereSnapshot>`.

### Adapter

- **Source:** Open-Meteo `v1/forecast` over a Kathmandu valley grid (reuse `KTM_BBOX` / point spacing ~0.02–0.03°).
- **Variables:** hourly `cloud_cover`, `pressure_msl`; take the nearest current hour (`forecast_hours=1` or first step of `forecast_days=1`).
- **Multi-point:** batch lat/lon lists (Open-Meteo comma-separated coordinates) within rate limits; fall back to chunked requests if needed.
- **Derive:**
 - Cloud cells above a threshold (e.g. ≥40%) → soft polygons (cell squares or simple dissolve).
 - Pressure → contour LineStrings at fixed intervals (e.g. 2 hPa) + local max/min → H/L points.
- **Cache:** `data/cache/weather/atmosphere-ktm-v1.json`, max age ~1 hour; `?refresh=1` forces refetch.
- **Offline:** deterministic grid for local runs / `WEATHER_ADAPTER=fixture` (code path).

### API

`GET /api/weather/atmosphere`

Response:

```ts
type AtmosphereSnapshot = {
 bbox: [number, number, number, number];
 fetchedAt: string;
 validAt: string; // forecast hour
 source: string; // e.g. open-meteo-forecast | stale-fallback | unavailable | offline
 licence: string;
 cacheHit: boolean;
 clouds: FeatureCollection; // properties: cloud_cover
 isobars: FeatureCollection; // properties: pressure_hpa
 centers: FeatureCollection; // properties: kind "high"|"low", pressure_hpa, label "H"|"L"
 extensions: Record<string, unknown>; // empty {}; reserved for tornado overlays
};
```

Wire in `apps/api/server.ts` and `packages/app` services, composition beside existing weather seed.

## Map UI

- **Command rail → Live feeds:** chip `atmosphere` / label **Atmosphere** (default **off**).
- **MapStage:** sources `atm-clouds`, `atm-isobars`, `atm-centers` (or one source with filters).
 - Clouds: fill, white/grey, opacity mapped from `cloud_cover`, below rain cells if both on.
 - Isobars: thin line, muted blue-grey.
 - Centers: symbol/text `H` / `L`.
- **Legend:** short entries when legend expanded.
- **Load:** fetch once with scene (or lazy on first toggle); don’t block scene if atmosphere fails.
- **Details / docs:** note Open-Meteo + estimated contours; not a NWP product for aviation.

## Error handling

| Case | Behaviour |
|------|-----------|
| Open-Meteo error / timeout | Serve stale cache if present (`source` includes `stale-fallback`) |
| No cache | Empty FeatureCollections, `source: "unavailable"`, console still works |
| Partial grid | Still return best-effort contours; log/provenance counts |

## Testing

- Unit: contour/H-L helpers on a tiny pressure field; cloud threshold → polygon count.
- Adapter: offline `fetch` → snapshot shape + disk cache hit on second `load()`.
- Optional smoke: live `/api/weather/atmosphere` returns 200 (skip in CI if offline).

## Tornado / later hook

- Do not implement tornado visuals in v1.
- Keep `extensions` and document that a future `severe` FeatureCollection (watches, tracks) can land beside `clouds` / `isobars` under the same endpoint or a sibling `/api/weather/severe`.
- Kathmandu remains flood/atmosphere; US tornado feeds stay out of this adapter.

## Files (expected)

| Area | Touch |
|------|--------|
| `packages/ports` | `AtmosphereSnapshot` + port |
| `packages/adapters/openmeteo/` | atmosphere adapter + contour helpers |
| `packages/app` | service |
| `apps/api` | route + composition |
| `apps/web` | `api.ts`, `App.tsx` vis, `CommandRail`, `MapStage`, legend |
| `tests/` | atmosphere unit tests |
| `docs/adapters.md` | one-line env/endpoint note |

## Decisions locked

- Geography: **Kathmandu valley only**.
- Look: **soft cloud opacity + pressure contours + H/L** (single Atmosphere toggle).
- Approach: **server GeoJSON from Open-Meteo grid**, disk-cached.
