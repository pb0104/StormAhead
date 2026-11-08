# Merged overlays on Maxar before/after swipe — design

**Date:** 2026-11-07 
**Status:** Approved (approach A / load merged.geojson) 
**Branch:** `feat/kathmandu-merged-source`

## Goal

When Before/after imagery is on, auto-show the Kathmandu merged pack layers on top of Pranshul’s Maxar mosaics so the swipe is evidence context, not bare imagery.

## Behaviour

- Swipe on → enable merged overlay visibility (flood, road_impact, hospital, power_dark, landslide, maxar_footprint, ndrrma_summary).
- Chips remain available to turn individual kinds off.
- Swipe caption unchanged in substance; note that overlays come from `merged.geojson`.

## Implementation

1. Merge `origin/main` into this branch (swipe + mosaics).
2. Import/serve `data/real/kathmandu/merged.geojson` in the web app.
3. MapStage: one `merged` GeoJSON source; filtered layers by `kind`; above Maxar pre/post.
4. OpsConsole/CommandRail: swipe toggle enables merged vis defaults.

## Non-goals

- Downloading Maxar COGs beyond existing mosaics.
- Rewiring the hindcast engine to the event log.
