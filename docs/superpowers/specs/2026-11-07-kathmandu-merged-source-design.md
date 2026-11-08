# Kathmandu merged open-data pack — design

**Date:** 2026-11-07 
**Status:** Approved for implementation (approach 1 / layers B / deliverable C) 
**Branch:** `feat/kathmandu-merged-source`

## Goals

- One **map** FeatureCollection and one **agent** event log for the Kathmandu / Bagmati ops AOI.
- Merge existing local layers with Maxar STAC footprints and an NDRRMA summary, without downloading Maxar COGs.
- Keep every feature and log row attributable (`source`, licence, planning vs observed).

## Non-goals (v1)

- Full Maxar imagery tiles / COG cache.
- Binding the ops console UI to these files (callers can switch later).
- National Nepal theater or Aug 2026 Rasuwa/EMSR927 AOIs outside the valley bbox.
- New dependencies — build script is **stdlib only**.

## AOI

Same as existing pack: `bbox = [85.284, 27.587, 85.493, 27.788]` (UNOSAT SPOT-6 analysis extent).

## Outputs

| File | Role |
|---|---|
| `data/real/kathmandu/merged.geojson` | Typed FeatureCollection for the map |
| `data/real/kathmandu/event_log.json` | Thin event log derived 1:1 from features (plus a few summary rows) |
| `data/real/kathmandu/provenance.json` | Extended with a `merged` block |

Rebuild: `python -I scripts/build_kathmandu_merged.py`

## Feature `kind` values

| kind | Geometry | Source |
|---|---|---|
| `flood` | MultiPolygon | Existing `flood_extent.geojson` (UNOSAT) |
| `hospital` | Point | `ops_layers.json` hospitals (BIPAD) |
| `road_impact` | LineString | `network.json` edges with `floodedShare > 0` |
| `power_dark` | Polygon | `night_lights.json` dark areas (Black Marble) |
| `landslide` | Point | `ops_layers.json` landslides (BIPAD) |
| `maxar_footprint` | Polygon | Maxar Open Data STAC `Nepal-Floods-Sept-2024` items intersecting AOI |
| `ndrrma_summary` | Point | Hand-coded Bagmati / national summary from NDRRMA SitRep #4 & loss assessment (labelled as report-derived, not site GIS) |

## Event log row shape

```json
{
 "id": "…",
 "time": "ISO-8601 or null",
 "place": { "lon": 0, "lat": 0, "label": "…" },
 "type": "flood|hospital|road_impact|power_dark|landslide|maxar_footprint|ndrrma_summary",
 "confidence": 0.0,
 "source": "…",
 "evidence": "…",
 "status": "observed|modelled|report",
 "featureId": "same as GeoJSON id when applicable"
}
```

Confidence defaults: observed physical products ~0.85–0.9; modelled road/hospital access ~0.6; report summary ~0.7; Maxar footprint presence (not damage) ~0.95.

## Architecture

```
flood_extent + network + ops_layers + night_lights
 + Maxar STAC (footprints only)
 + NDRRMA constants
 │
 ▼
 scripts/build_kathmandu_merged.py
 │
 ┌───────┴────────┐
 ▼ ▼
 merged.geojson event_log.json
 └────── provenance.json ──┘
```

## Error handling

- Maxar fetch failure: write pack without footprints, record error in provenance `merged.maxarError`.
- Missing local inputs: abort with a clear path list.

## Test

Script ends with asserts: flood feature present, hospital count > 0, road_impact count > 0, event_log length == features (+ optional summary-only rows accounted for).
