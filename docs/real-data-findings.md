# Kathmandu valley real-data feasibility (checked 2026-11-06)

Valley box used: lon 85.29–85.49, lat 27.59–27.79. Event: Sept 27–28 2024 floods. Nothing below is wired into the app yet.

## Imagery — Maxar Open Data, "Nepal-Floods-Sept-2024" (STAC, public on AWS, licence **CC-BY-NC-4.0**: non-commercial)
Valley acquisitions (from each acquisition collection's temporal extent):

| Date | Role | Items |
|---|---|---|
| 2022-11-22, 2023-04-04, 2024-01-13 (x2), 2024-04-25 | **pre-event** | 15, 15, 20+10, 20 |
| 2024-10-06 (two acquisitions) | **post-event** | 25, 15 |

Latest pre-event scene is ~5 months before the flood; the post-event scene is ~8 days after. Per-scene cloud cover/usability is **not yet checked**.

## Ground truth — UNOSAT (HDX, licence **CC BY-SA**)
- The product you linked (**3993**, "Kathmandu … 30 Sep 2024") ships **no Kathmandu layers**: only Sentinel-1 extents for Koshi/Madhesh and Gandaki/Lumbini/Bagmati/Madhesh (max lon 84.97, west of the valley). Same in its geodatabase.
- **Product 3996** (`FL20240928NPL_SHP.zip`, ~121 MB) does contain valley data from SPOT-6, 30 Sep 2024:
  `Spot6_20240930_FloodExtent_Kathmandu` (112 polygons), `…AnalysisExtent_Kathmandu`, `…PotentiallyAffectedBuilding_Kathmandu` (5,056 buildings).
- Caveat: an optical flood-extent *product* is itself an analyst/algorithm output with its own error and cloud/urban limits; it is "best available reference", not perfect truth. Analysis extent (85.284–85.493 × 27.587–27.788) defines where "not flooded" can be asserted.

## Pre-event roads — OpenStreetMap
- ~~Overpass ignores the `[date:]` historical parameter.~~ **CORRECTED 2026-11-07: attic queries DO work.** The earlier check read `osm3s.timestamp_osm_base`, which always reports the database's own date; the returned *data* is historical. Verified by building counts in this box: 241,174 (2018-01-01), 289,698 (2021-01-01), 356,900 (2024-01-02), 373,981 (today) — monotonic, so the date filter is honoured. A **2024-09-26** network (one day pre-event) is therefore obtainable; `scripts/fetch_network_attic.mjs` builds it, and it does not change the result (see hindcast-results.md).
- Geofabrik publishes `nepal-240101.osm.pbf` (2 Jan 2024, 386 MB, ODbL) — a clean pre-event snapshot, but 9 months stale. No Aug/Sept 2024 snapshot is available (404).

## Preview of the evaluation scale (using CURRENT OSM, preview only — not a result)
Of 1,700 main-road/bridge ways in the flood-extent bbox, 126 intersect the observed flood extent, including 86 of 375 bridge ways. So a road-exposure precision/recall evaluation is feasible. Many "bridges" are footbridges/small crossings; filtering needed.

## Not yet decided / not available
- **A pre-event hazard prediction.** No pre-event forecast of the footprint was obtained. A terrain-based floodplain estimate needs a DEM (Copernicus GLO-30 on AWS is a candidate; unverified) and would be a *susceptibility* estimate, not a forecast.
- DHM/BIPAD pre-event warnings: not investigated.

## Independent impact records — BIPAD incident API (public, checked 2026-11-06)
`https://bipadportal.gov.np/api/v1/incident/` returns incident records with date, point/polygon, `verified` flag and a `loss` object (deaths, missing, injured, people/families affected, houses/roads/bridges/electricity destroyed or affected, economic loss).
For 2024-09-26…10-06: 487 incidents nationally, **44 inside the valley box (all `verified`)** across four hazard codes (10: 4, 11 (flood): 11, 14: 11, 17: 18 — code meanings not yet mapped; includes landslides/heavy rain/fire).
Limits: reported (not census) records, ward-level locations, small sample, absence of a report ≠ absence of impact. Independent of the UNOSAT flood extent, so usable as ground truth for *cascading* impacts. (UNOSAT affected buildings are derived from the same flood extent, so they only validate direct exposure.)
