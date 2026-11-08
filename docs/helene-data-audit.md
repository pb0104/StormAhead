# Hurricane Helene (western NC) — data audit (checked 2026-11-06)

Read-only feasibility check. **Nothing here is wired into the app.** "Verified" = I queried it and saw real records; anything else is listed under *Not verified*.
Event window used: Helene landfall/flooding ≈ 2024-09-25 → 2024-09-29; aftermath to ~2024-10-06.

## Ground truth for FOCUS 1 (road closures)
| Source | What I saw | Notes / caveats |
|---|---|---|
| **NCDOT TIMS "State Maintained Historical TIMS Incidents Hurricane Helene"** (ArcGIS FeatureServer, public) | **1,502 incident points**: Condition Closed 1,214 / Partial Access 167 / Open 121; 1,039 `Weather Event`; reasons like "High Water", "closed due to flooding/dam release"; fields: Road, County, StartDateTime, EndDateTime, Reason, Detour, LanesAffected, RouteType. Top counties: Henderson 139, Ashe 136, Avery 96, Buncombe 92, Haywood 91, Watauga 89, Yancey 70, McDowell 69, Mitchell 57. Start range begins **2024-09-25 11:21Z**. | **Points, not lines** (line layer returned an error) → must be snapped to road segments. **State-maintained roads only** (SR 1,151, NC 163, US 128, I 60) — no town/private roads. Includes records whose end dates run to 2026–2027 (long repairs / unrelated maintenance) → must window by time and event type. NCDOT disclaimer: no liability for errors. A second layer has 1,584 rows (slightly different filter). Closure *completeness* unknown. |
| **USGS Hurricane Helene Landslide Inventory** (public FeatureServer) | 2,217 points, fields `Source` (e.g. DOT), `Impact` (e.g. Road). | "Preliminary". Minimal attributes, no dates. |
| **NC Geological Survey post-Helene landslide inventory** (NC DEQ; public) | 2,607 landslide **polygons** with Material/Movement type, `Impact`, `Damage`, `Fatalities`, basemap used; 603 observation points; 20 ground ruptures. | The service I queried is marked *deprecated* (data moved to a newer service — not yet located). Mapped after the event from imagery (2024 Nearmap) — post-event evidence. |

## Inputs that can be time-sliced for a replay
| Source | Status |
|---|---|
| **Road network** — Geofabrik `north-carolina-240101.osm.pbf` (2 Jan 2024, 368 MB, ODbL) | Exists. **No Aug/Sep 2024 snapshot** (404). `north-carolina-latest` also exists but is post-event → must NOT be used. |
| **River gauges** — USGS NWIS instantaneous values | Works. French Broad at Asheville (03451500): 480 readings 25–29 Sep, peak 24.82 ft; Marshall: peak 20.31 ft. Timestamped → can be replayed up to a cut-off. (Gauges can fail/under-read in extreme events.) |
| **NWS warnings archive** — Iowa Environmental Mesonet | Returns a shapefile zip: 435 warning polygons for GSP/RAH offices, 24 Sep–2 Oct (flash flood, tornado, hurricane types). Timestamped issue/expire times. Not unpacked yet. |
| **Imagery** — Maxar Open Data `HurricaneHelene-Oct24` (CC-BY-NC-4.0) | 42 acquisitions; **24 intersect western NC**. Post-event: 2024-10-02 → 10-06 (many). Pre-event: sparse and uneven — e.g. 2024-09-22, 2024-02-03, 2023-09-08, 2022-01-07, 2019/2020. A true same-place pre/post pair exists for some areas (e.g. Watauga/Ashe tile −82.5..−82.4, 36.1..36.2: 2023-09-08 vs 2024-10-02). Cloud cover and usability not checked. |
| **Dams** — National Inventory of Dams (ArcGIS Esri_US_Federal_Data) | Layer found (names, owner, lat/lon, state regulation…). My `STATE='NC'` query returned 0 — **filter/field not resolved**, NC dam count unverified. |

## FOCUS 2 (resources) — power, shelter, food
| Source | Status |
|---|---|
| **EAGLE-I outages** (ORNL, figshare, CC BY 4.0) | Exists: county-level, 15-minute, 2014–2025, one CSV per year (~1.2 GB each). Need the 2024 file; **coverage/quality for NC Sept 2024 not checked** (utilities' public maps; DQI file provided). Fits "power outages" at county granularity only — not individual grid failures. |
| Shelters, food | **Not investigated.** (Candidates: FEMA/Red Cross shelter lists, county EOC data — availability unknown.) |
| Cell towers / outages | FCC DIRS: **not found** via ArcGIS search; OpenCellID needs a key. Unverified. |

## Social media and radio
**Not probed**, deliberately: platform terms and API access change (X is effectively closed; Reddit/Bluesky have terms and rate limits), and radio/scanner archives (e.g. Broadcastify) have licensing limits. Realistic options: a small hand-labelled feed clearly marked as a planning layer, or an open public archive if one is found.

## Terrain / rainfall / susceptibility — **not audited yet**
DEM (USGS 3DEP or Copernicus), rainfall (MRMS/Stage IV), pre-event landslide susceptibility (NCGS maps) are the obvious predictors for closures and still need checking.

## Design implications (what this audit suggests)
1. **Road closures have real ground truth** (TIMS + landslide inventories) — a much better evaluation basis than Kathmandu's 19 incidents.
2. **Use a nowcast framing to avoid leakage:** at replay time *t*, give the model only data stamped ≤ *t* (pre-storm OSM, forecasts/warnings, gauge readings, terrain); predict which segments will be **newly reported closed after *t*** (TIMS StartDateTime > *t*). Reports already published before *t* are legitimately known to authorities and are not predictions.
3. **Baselines are mandatory** (lesson from Kathmandu): e.g. "within X m of a gauge-flooded stream", "low height-above-stream", "already-closed neighbours", random same-size sets.
4. **Matching problem:** TIMS points ↔ OSM edges (snap tolerance, one-to-many, duplicates); only state-maintained roads are scored.
5. Post-event Maxar/landslide polygons are **evaluation or visual context only**, never inputs to a pre-/during-event prediction.
6. Public-facing alerts are higher-stakes than the Kathmandu analysis: replay only, labelled as console drafts, and human approval before anything is "sent".

## Addendum — reporting lag in the NCDOT records (measured while building the replay)
All **1,132** in-window TIMS records carry a `CreationDate` **at least 13 days after their `StartDateTime`** (median ≈ 18 days; p90 ≈ 78 days). 655 were created on 2024-10-15 by a single admin account and 490 by the TIMS app. So NCDOT **reconstructed** the event timeline after the fact; this is **not** an archive of what DriveNC showed during the storm.
Consequences: (1) the replay labels itself a reconstruction; (2) `start`/`end` times are retrospective entries and may be imprecise; (3) a genuine "what was known at time *t*" test is impossible with this table alone — for the nowcast task, closure *start* times are ground truth for when roads actually closed, but they must never be offered to the model as if they had been visible at that moment.
