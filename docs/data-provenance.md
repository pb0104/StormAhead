# Data provenance

| In the console | Status |
|---|---|
| Road geometry (about 6,000 main-road segments plus the closed and stranded ones) | **Real**: OpenStreetMap, 2 Jan 2024 |
| Satellite base | **Real**: Esri World Imagery tiles (streamed), Sentinel-2 mosaic (bundled fallback) |
| Before / after imagery (command rail) | **Real**: Maxar Open Data mosaics, 13 Jan 2024 and 6 Oct 2024. After mosaic is grading / ground-truth context (held out of live agents) |
| Maxar scene footprints | **Real**: STAC footprints from the Nepal Floods Sept 2024 collection |
| 3D terrain | **Real**: public elevation tiles (streamed) |
| Hospital names and positions (6 shown) | **Real** names and positions from OSM. Access status (ok, degraded, lost) from cascade on the observed flood |
| Airports (3) | **Tribhuvan International Airport** at its real position (on the runway in the imagery), plus 2 helipads; role and status from the console scene |
| Army bases (3) | Named sites and roles; status from distance to closures |
| Schools (16) | Named sites; risk from cascade and hazard layers |
| Which roads are closed (12 closures, 6 cut-off pockets) | **Selected** from the engine's closed and stranded roads for the console view |
| Rain forecast (weather agent) | A value you set, with range and intensity from a simple rule |
| Flood extent | **Real**: UNOSAT SPOT-6, observed 30 Sep 2024 |
| Flood depth | Ordering from real elevation tiles (terrain agent), scale from rain reference |
| Terrain low-ground patches, rain cells | Drawn from terrain / rain agents |
| Power outages (9 dark areas) | **Real, observed**: NASA Black Marble nightly lights. Cells whose lights fell below half of normal on clear nights 29 Sep to 2 Oct, against 19 Aug to 25 Sep (103 dark cells of 906 seen; 0.3% false-dark rate on ordinary nights). 28 Sep was clouded over. "Likely lost power", not confirmed |
| Landslide zones (4), public-alert zones (2) | Hazard and alert zones on the map |
| Cell sites (328, merged from 902 cells) | **Real positions** from OpenCelliD (crowd-sourced estimates; current database, `firstSeen` marks sites that may postdate the flood). Status from flood extent + night lights: inside observed flood = down; within 200 m of flood or in a dark cell = at risk |
| Regional internet connectivity (chart in the drawer for cell sites and pockets) | **Real**: IODA, Bagmati zone. Networks visible fell 24% at 07:45 on 28 Sep, Nepal time. Regional only |
| Dams (2), social posts, radio | Social from Reddit; radio listen-only; dams as map assets |
| QRT staging, food depots, shelters | Responder and depot network on the map |
| Evidence text, recommended actions, headcounts, households | Generated from the scene and public feeds |

## Data sources and licences

| Source | Used for | Licence / terms | Caveats |
|---|---|---|---|
| **OpenStreetMap** via Geofabrik `nepal-240101.osm.pbf` (2 Jan 2024) | Pre-event road network, hospitals, place names | ODbL, © OpenStreetMap contributors | Snapshot is 9 months before the event, so new roads are missing. Speeds are assumed per road class. Service roads, tracks and paths are excluded. 185 "hospital" features include small clinics |
| **UNOSAT** SPOT-6 flood extent, product 3996 (`Spot6_20240930_FloodExtent_Kathmandu`, observed 30 Sep 2024) | Given hazard in the hindcast engine (not drawn in the ops console) | CC BY-SA | Optical extent is an analyst/algorithm product with its own error and cloud/urban limits. Product 3993 (also referenced in earlier notes) ships no Kathmandu layers |
| **BIPAD Portal** incident API, 26 Sep to 6 Oct 2024, verified, in the valley extent | Scoring only, never a model input | **Licence not stated on the API.** Confirm before redistributing | Ward-level report points. Missing report is not missing impact. Small sample. The data file is in this repo |
| **Sentinel-2 cloudless 2020** (EOX WMS), bundled as `assets/valley.jpg` | Offline fallback satellite base | CC BY-NC-SA 4.0 (non-commercial). Contains modified Copernicus Sentinel data | 10 m resolution, so soft when zoomed. Shown dimmed |
| **Esri World Imagery** tiles (Esri, Maxar, Earthstar Geographics) | Sharper streamed satellite base | Esri public tile service terms | Needs internet. Public service, no licensed key: check the terms before redistribution |
| **AWS Terrain Tiles** (Mapzen, terrarium encoding) | 3D terrain, hill-shading, and the terrain agent's elevation reads | Public dataset, attribution shown on the map | Needs internet. 3D only |
| **Maxar Open Data**, "Nepal Floods Sept 2024" collection | **Used**: before/after mosaics in the command rail + evaluation ground truth (clear-sky visual change); STAC footprints on the map / satellite agent | CC BY-NC 4.0 | 6 Oct is partly cloudy and post-peak; clear tiles grade change, cloudy tiles are skipped. See [real-data-findings.md](real-data-findings.md) |
| **Google Photorealistic 3D Tiles** via Cesium ion (asset 2275207) | Optional photoreal close-up of a selected item | Cesium ion Community plan is free for personal and non-commercial use, capped at 1,000 root tiles a month. Google attribution is shown. Subject to the Google Maps Platform terms | Needs a Cesium ion token and internet. Check the plan terms before commercial use |
| **OpenCelliD** per-country download (MCC 429), via `scripts/fetch_opencellid.mjs` (needs `OPENCELLID_KEY` in `.env`) | Cell-site positions (`data/real/kathmandu/cell_sites.json`) | CC BY-SA 4.0, attribute OpenCelliD | Positions are estimates from phone reports. Database is current, not pre-event. Flood-time site status is not public |
| **NASA Black Marble** VNP46A2 v2 via `scripts/fetch_blackmarble.py` (needs `EARTHDATA_TOKEN`, an Earthdata Login token; downloads from the Earthdata Cloud mirror; ~1.4 GB of tiles cached outside the repo) | Power outages (`data/real/kathmandu/night_lights.json`) | NASA data, free with citation (doi:10.5067/VIIRS/VNP46A2.002) | Monsoon cloud: 28 Sep fully clouded, 26–27 Sep missing. Thin cloud can also dim lights |
| **IODA** (Georgia Tech) API, via `scripts/fetch_ioda.mjs` (no key) | Regional internet connectivity, 20 Sep to 5 Oct 2024 (`data/real/kathmandu/ioda.json`) | Free for research; credit IODA | Finest unit is the old Bagmati zone, so it shows when, not where |
| **Google Fonts** (Bricolage Grotesque, IBM Plex Sans/Mono) | UI typography | Open fonts | Loaded from the web. Falls back to system fonts offline |
| Other operational layers | Towers, weather, shelters, depots, QRT, outages, alerts, landslide zones | Public feeds where available | See Details → Sources |

Machine-readable provenance: [data/real/kathmandu/provenance.json](../data/real/kathmandu/provenance.json). Fuller notes: [sources.md](sources.md), [real-data-findings.md](real-data-findings.md), [assumptions.md](assumptions.md).

## Rebuilding the hindcast data

The derived data under `data/real/kathmandu/` is committed. To rebuild it:

```bash
node scripts/fetch_bipad.mjs                     # incidents.json (evaluation only)
node scripts/fetch_buildings.mjs                 # buildings.json (pre-event footprints; needs internet)
node scripts/fetch_wards.mjs                     # wards.json (evaluation units; needs internet)
python -I scripts/build_maxar_mosaics.py         # before/after imagery mosaics (needs internet + Pillow)
node scripts/fetch_network_attic.mjs --date 2024-09-26 --out data/real/kathmandu-0926   # optional: 1-day-pre-event network
pip install -r scripts/requirements.txt
python -I scripts/prepare_kathmandu.py --osm nepal-240101.osm.pbf \
  --flood Spot6_20240930_FloodExtent_Kathmandu.shp --out data/real/kathmandu
```

Download the Geofabrik snapshot and the UNOSAT product 3996 shapefile separately first (links in [real-data-findings.md](real-data-findings.md)).

See also: [adapters.md](adapters.md), [engine.md](engine.md).
