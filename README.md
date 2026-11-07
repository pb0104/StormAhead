# StormAhead

Helping people get through a disaster by answering two questions: **which roads can we still use, and where should resources go?** For two audiences — the **public** (alerts about closed or dangerous roads) and **authorities** (what's blocked, for quick-response teams and evacuation planning). AI agents combine data sources into one picture and *propose* actions; **a person approves before anything goes out.**

The app has three modes: **Kathmandu ops console** (authorities cascade demo), **Hurricane Helene replay** (western NC), and the **Kathmandu hindcast** research view.

## Status (honest)

| Piece | State |
|---|---|
| Helene replay: pre-storm road network + NCDOT-reported restrictions on a time slider | **Built** (Buncombe + Haywood + margin; 158 storm-related records) |
| Authorities view (counts, counties, newest closures, table) | **Built** |
| Public view: rule-based alert *drafts* + human approve/reject (nothing is sent) | **Built** (drafter is a simple rule-based module, not an AI model) |
| Kathmandu ops console (map-first cascade demo, modular adapter API, atmosphere, shelter buildings) | **Built** (demo / mock layers + real OSM roads, buildings, elevation) |
| **Road-closure prediction** (terrain, rain, gauges, landslide susceptibility) | **Not built** — next, scored against NCDOT/USGS records with baselines |
| Resources: food, shelter, power | **Not built** (EAGLE-I outage data identified) |
| Social media, radio, cell towers, dams (Helene) | **Not built** (see [docs/helene-data-audit.md](docs/helene-data-audit.md)) |
| Kathmandu hindcast engine | Built; **no demonstrated predictive skill** ([docs/hindcast-results.md](docs/hindcast-results.md)) |
| Forward pipeline: gauges + rain + terrain → ward flood and landslide risk, scored on held-out years ([docs/pipeline.md](docs/pipeline.md)) | **Built** (backend, `/api/pipeline/*`, `npm run eval`). Same-day skill; no reliable next-day lead. `DetectView.tsx` kept but not rendered |

**Important:** NCDOT entered every Helene record ≥ 13 days after it started, so the replay timeline is a *reconstruction*, not what officials saw live. The UI says so.

The Kathmandu ops console loads scene, weather seed, terrain/flow assessment and map tiles from a **modular adapter API** (`/api/scene`, `/api/weather/seed`, `/api/assessment`, `/api/tiles/*`). Weather can use Open-Meteo (`WEATHER_ADAPTER=openmeteo|mock`). See [docs/adapters.md](docs/adapters.md). Building footprints come from `GET /api/buildings`.

> In the ops console and Helene public drafts, nothing is sent — assign/approve only changes the screen.

---

## Run it

Requires Node ≥ 22.5. No API keys. The console streams some map tiles, so it needs internet for full detail (see [Data sources](#data-sources-and-licences)); without it the map falls back to a softer bundled satellite image.

```bash
npm install
npm start        # builds the web app, serves UI + API on http://127.0.0.1:3001
npm run dev      # hot reload: API :3001 + Vite :5173 (open http://localhost:5173)
npm test         # cascade + hindcast + adapter/tile-cache + Helene replay tests
npm run eval     # score the forward pipeline (writes data/real/kathmandu/pipeline_eval.json)
npm run typecheck
```

Rebuilding the real dataset is optional and only needed if you change the inputs (see [Rebuilding the hindcast data](#rebuilding-the-hindcast-data)).

---

## Product story

Authorities see a flood map, but the costly surprises are the **knock-on effects**: roads and places that stay dry yet get cut off. The console tells that story in one screen:

1. Open the map: muted road network and hazard context (terrain low ground, rain).
2. Press **Run cascade assessment**. Closed roads are revealed one by one as the dominant red signal, then cut-off road pockets, landslide zones and grid outages.
3. Click a closure, pocket, landslide zone, hospital, tower, outage or alert zone. A drawer shows **what failed and why** (grouped by input) and **recommended response**: QRT evacuation, food, shelter, grid crew and a public-alert preview.
4. Assign or issue those actions as **simulated** authority actions (local screen state, with undo).

Audience: authorities only. There is no public view.

---

## The ops console

### Layout

- **Map (hero).** Full-bleed MapLibre map, no basemap provider key. Base is satellite imagery with the OSM road network on top.
- **Command rail (left, collapsible).** Wordmark and one line of context, a mock scenario and time selector (Now, +6 h, Peak +12 h; later stages reveal more closures), the **Run cascade assessment** button, and compact toggles:
  - *Inputs:* Terrain, Road network, Cell towers, Weather, Atmosphere, Dams, Hospitals, Schools, Airports, Helipads, Army bases.
  - *Outputs:* Road closures, Flooding, Runoff flow, **Shelter & evacuate**, Landslides, QRT staging, Food, Shelter, Outages.
  - A legend that shows four symbols by default and the full set on request.
- **Status strip (top).** Up to seven counts (closed roads, cut-off pockets, landslide zones, schools at risk, hospitals at risk, grid outages, and buildings to evacuate when the real building layer is loaded). They are **filters**: clicking one zooms to that category's affected area, lights up the affected roads in the category's colour and dims everything else. If you click one before running the assessment, it runs the assessment first. Also holds the **2D / 3D** toggle, a "DEMO DATA" tag and the **Details** link.
- **Context drawer (right, bottom sheet on small screens).** Opens only when you select something on the map. Sections: *What failed, and why* and *Recommended response*. Response cards are the only cards in the UI, and each is assignable.
- **Details dialog.** Sources (real vs mock), assumptions, and a log of simulated actions. This is the only place secondary information lives.

### Behaviours worth knowing

- **Flooding is animated water with depth.** After a run, the real UNOSAT observed flood extent (30 Sep 2024) is drawn as rippling water, coloured by depth (light is shallow, dark is deep). Depth comes from two demo agents: a **weather agent** (a mock forecast you set with the rain slider or the 6, 10 and 15 inch presets) and a **terrain agent** (reads real elevation tiles in your browser and ranks each flood patch by how low it sits). The depth model is illustrative, not a hydraulic simulation: depth scales linearly with rain, the deepest patch is set to 2.4 m at a 10 inch reference (an assumption), patches under 0.2 m show dry, and the time selector applies 40%, 75% and 100% of the forecast rain. It can only show less water than the observed extent, or deeper water inside it, never a larger area. In the photoreal close-up the water is an animated surface raised by that depth. The extent itself is an optical product that likely under-detects urban flooding. Hover a patch for its depth.
- **Runoff flows downhill and pools.** A **flow agent** routes the forecast rain over a 70 m elevation grid built from the same real elevation tiles: water drains off slopes and collects in channels and low ground. Pooled water is drawn in blue, with a modest number of slow streaks that follow the slope, mostly along the main channels (computed by D8 flow accumulation), drawn at screen resolution at a fixed gentle speed. It is a teaching model: no drainage network, soil or buildings, the grid edge is an outlet, and the headline depth is the median of the wet cells because single noisy elevation pits can hold unrealistically deep water. It is separate from the observed-extent flooding above and uses the Rain forecast slider and time selector.
- **Shelter and evacuation, on real buildings.** After a run, 7,115 **real** pre-event OSM building footprints (2 Jan 2024, the same snapshot as the roads) are drawn and coloured by what to do with them: red to evacuate, amber to shelter on the upper floors, green where a dry upper-floor building inside a cut-off area can take people in, grey where OpenStreetMap has no height so **no judgement is offered**. The reading is depth-driven: the terrain and weather agents give each flood patch a depth, a building loses one floor per 3 m of water, and the verdict changes as you move the rain slider or the time selector. Capacity assumes 3.5 m² per person (Sphere) over 70% of the footprint — an order-of-magnitude figure, not a survey. In 3D the footprints are extruded by their **tagged** storey count. Buildings that are dry, reachable and unremarkable are not drawn. The layer is fetched from the API; without it the rest of the console is unchanged.
- **Zoom to affected areas.** Strip filters fit the map to the affected features. Affected roads per category: closed roads → the closed segments; cut-off pockets → the stranded roads; landslide zones and grid outages → the main roads (trunk to tertiary) that run through each zone; hospitals at risk → the closures within 3.5 km of those hospitals; schools at risk → the closures within 1.2 km of those schools. Selecting a single item also fits the map to it. Closures and cut-off pockets can recommend asking the nearest army base for engineers, boats or trucks, and pockets can recommend an airlift from an open airport or helipad.
- **Recommended responses** are computed from the mock fixtures: the nearest QRT staging point, food depot with stock, shelter with free places, or outage feeder. The map draws dashed lines from the selection to the recommended resources.
- **2D / 3D.** 3D turns on terrain relief and hill-shading, tilts the camera and enables rotation. Roads, closures and zones drape over the terrain. 2D is flat and works offline.
- **Building types have their own icons.** Hospital (cross), school (house), airport or helipad (plane), army base (star), shelter (tent), food depot (crate) and QRT staging (shield), drawn in `icons.ts` and reused as inline SVG in the legend and drawer. The ring colour shows state (green ok, amber at risk or degraded, red high risk or access lost) and at-risk buildings carry a "!" badge. **Schools** are annotated with risk, computed in the demo fixtures from distance to landslide zones, closed roads and outage areas, and their drawer offers student evacuation, a hold-on-site order, shelter and an alert.
- **Photoreal close-up (optional).** The drawer has **View in photoreal**, which opens just the selected item (and optionally the resources it links to) over Google Photorealistic 3D Tiles using CesiumJS. It needs a free Cesium ion token: put `VITE_CESIUM_TOKEN=...` in `apps/web/.env.local` (gitignored) or paste it into the prompt, which stores it in the browser only. Cesium loads from a CDN only when you open it. The first tiles take a few seconds to stream. Without a token, the rest of the console works unchanged.
- **Motion** is limited to three things: the staged reveal of closures, the drawer slide-in, and the count change in the status strip. `prefers-reduced-motion` turns them off.

### Code map (`apps/web/src`)

| File | Role |
|---|---|
| `App.tsx` | State and orchestration: run animation, filters, selection, simulated actions |
| `MapStage.tsx` | MapLibre map: layers, reveal, filtering, selection, zoom-to-affected, 2D/3D |
| `CommandRail.tsx`, `StatusStrip.tsx`, `ContextDrawer.tsx`, `DetailsDialog.tsx` | The four UI surfaces |
| `buildings.ts` | **Real** building footprints: fetch, depth join, shelter/evacuate reading |
| `mock/demo.ts` | **Demo fixtures** (entities, GeoJSON, affected-roads helper) |
| `mock/advice.ts` | Invented evidence and recommended actions per entity kind |
| `icons.ts`, `Glyph.tsx` | Per-building-type icon shapes for the map (canvas) and UI (SVG) |
| `mock/network.json` | Fixture: OSM road geometry plus the selected closures and pockets |
| `assets/valley.jpg` | Bundled Sentinel-2 mosaic, the offline fallback base |
| `styles.css` | Console styles |
| `HindcastView.tsx`, `hindcast.css`, `api.ts` | The earlier research view of the real hindcast. **Kept, but not rendered.** Render `<HindcastView />` from `App.tsx` to bring it back |

---

## The hindcast engine (real data)

Lives in `packages/analysis/cascade.ts`, served by `apps/api`. It is deterministic and rule-based. The activity feed shows real tool calls, never presented as LLM reasoning.

**Question.** Given the flood (UNOSAT observed extent, 30 Sep 2024, a *given input*, not predicted), can we predict knock-on impacts that the flood map alone does not show, using only a **pre-event** road network?

**Steps** (`HindcastService.run` in `apps/api/hindcast.ts`):

1. **Coordinator**: asserts the road snapshot predates the event (`assertNetworkPreEvent`), so the pre-event claim cannot be silently false. The observed extent is used only as the hazard. Incident reports are withheld.
2. **Hazard Agent**: loads the observed flood extent.
3. **Infrastructure Agent**: closes roads by an adjustable rule: a bridge touching the flood, or at least `closeShare` (default 30%) of the road's length flooded. *Exposed does not mean closed.*
4. **Access Agent** (`analyzeCascade`): multi-source Dijkstra from open hospitals on the full network and on the network with closures. Reports dry places that lose all hospital access (*isolated*) or whose trip gets at least +10 min and at least 1.5× slower (*degraded*), and dry open roads cut off from the main network (*stranded*). A flooded hospital counts as unavailable.
5. **Shelter Agent**: reads 7,115 pre-event OSM building footprints (shelter-relevant types) and gives each a shelter reading — flooded with floors above the water (shelter in place), flooded with none (evacuate), or a dry upper-floor building inside a cut-off area (local refuge). A building with no usable `building:levels` gets **no judgement**, never a guessed height.
6. **Verification Agent**: scores afterwards against withheld BIPAD reports, two ways. (a) `scoreAgainstIncidents` — the point test, with a random baseline (permutation test, 2,000 sets), a nearest-the-flood baseline, and sensitivity to the closure threshold and match radius; landslides scored separately as an out-of-model check. (b) `scoreByWard` — a **per-agent scorecard** over 203 ward polygons, reporting each agent's hits, **false alarms**, precision, recall and F1 against the same baselines, plus the given hazard as the bar to beat. See [Per-agent scorecard](#per-agent-scorecard).

**API** (Fastify, `apps/api/server.ts`): `GET /api/health`, `GET /api/hindcast/meta`, `GET /api/hindcast/geo`, `GET /api/buildings` (real footprints for the console), `GET /api/scorecard` (the per-agent evaluation, cached), `GET /api/verification` (the same scorecard as map geometry), `POST /api/hindcast/run` (optional body: `closeShare`, `bridgeClosesOnAnyContact`, `degradeMinutes`, `degradeRatio`). Agent events are in the run response. The server also serves the built web app from `apps/web/dist`.

**Spatial pre-computation** (per-road flooded share, per-place in-flood flag and distance to flood) is done offline by `scripts/prepare_kathmandu.py` and committed as derived data. The impact reasoning itself is all in TypeScript.

### Honest hindcast result

Run 2026-11-06 with default parameters. Full detail in [docs/hindcast-results.md](docs/hindcast-results.md).

| | |
|---|---|
| Road segments touching the flood / treated as closed | 462 / 310 (54 bridges), of 38,038 |
| Places directly flooded | 9 of 718 |
| Cascade: dry places with no hospital access / degraded | 1 / 0 |
| Cascade: dry roads stranded | 428 |
| Shelter-relevant buildings loaded / in the flood extent / dry but cut off | 7,115 / 11 / 12 |
| Scored incidents (verified BIPAD flood/rain reports with impact) | 19, none inside the flood extent |
| Within 1,000 m of a predicted cascade item | 16 of 19 (84%) |
| Random same-size sets (mean) | 18.7 (p ≈ 1.0) |
| Nearest-the-flood baseline | 16 |

**Verdict: no demonstrated predictive skill.** The 84% headline is not evidence, because random sets of the same size do as well and the proximity baseline ties it. Exploratory checks (added after seeing the result, so not primary): at 250 m the model gets 0 of 19 against random 8.5, and at 500 m 7 of 19 against 15.9. The landslide check (15 of 17 against random 14.6, p ≈ 0.55) also shows no skill. Adding the 7,115 real building footprints as cascade targets (exploratory) **did not change this**, and nor did rebuilding the road network one day before the event instead of nine months earlier — so two hypotheses are now tested and rejected. Likely reasons are in the results doc: OSM lists 185 hospital features (many small clinics) so hospital access rarely breaks, stranded roads cluster while reports are spread, the optical flood extent probably under-detects urban flooding, and 19 incidents is a small sample.

### Per-agent scorecard

Visible in the console under **Details → Evaluation**, which opens on this tab and leads with a plain-language
verdict — what the engine got right, what it got wrong, why that is not skill, what it does *not* mean, and what
would change the answer — followed by a generated one-sentence reading of every row, so the prose cannot drift from
the numbers. Served by `GET /api/scorecard`, computed in `packages/analysis/wards.ts`.

The 1 km point test could not discriminate: in a dense valley almost any same-size set covers the incidents, so
every baseline tied. Scoring on **wards** (the unit BIPAD reports are actually collected in) makes false alarms
countable, so an agent can no longer look good by flagging everything. 19 scorable incidents fall in 10 of 203 wards.

| Agent | Wards flagged | Hit | False alarm | Precision | Recall | F1 | Random F1 | p |
|---|---|---|---|---|---|---|---|---|
| *Hazard (GIVEN — not a prediction)* | 67 | 6 | 61 | 0.09 | 0.60 | 0.16 | 0.09 | 0.067 |
| Infrastructure Agent | 59 | 6 | 53 | 0.10 | 0.60 | 0.17 | 0.08 | 0.030 |
| Access Agent | 102 | 6 | 96 | 0.06 | 0.60 | 0.11 | 0.09 | 0.392 |
| Shelter Agent | 10 | 2 | 8 | 0.20 | 0.20 | 0.20 | 0.05 | 0.082 |
| All agents combined | 125 | 9 | 116 | 0.07 | 0.90 | 0.13 | 0.09 | 0.056 |

The hazard row is a model *input*, so it is the bar: an agent that does not beat it adds nothing to the flood map.
**The Access Agent flags half the valley** (102 of 203 wards) to find the same wards the Infrastructure Agent finds
with 59, at p = 0.39. The **Shelter Agent raises the fewest and most precise concerns**, on 2 hits. The
Infrastructure Agent is the only one under p < 0.05, **and it does not replicate**: on a 1-day-pre-event network it
becomes p = 0.052. Read the table as negative. Full tables in [docs/hindcast-results.md](docs/hindcast-results.md).

### Predictions against what actually happened

The engine does **not** predict the flood — the observed extent is a *given input* — so there is no
predicted-vs-actual flood map to draw, and drawing one would imply skill the model does not claim. What it predicts
is the knock-on effects, so that is what gets verified.

Turn on **Verification (real)** in the command rail. Each of the 203 wards is drawn by outcome, with the withheld
incident reports as white dots: **9 hit, 1 missed (Lalitpur-12), 116 false alarms, 77 correctly left alone.** The
116 false alarms are drawn, faintly but visibly, because over-flagging is the main finding. A banner stays on
screen while the overlay is active, since the closures drawn underneath are demo data and are not what is scored.

### Before / after imagery (context, not validation)

**Before / after imagery** in the command rail swipes between two Maxar Open Data mosaics, 13 Jan 2024 and
6 Oct 2024, built by `scripts/build_maxar_mosaics.py`. The observed UNOSAT footprint is drawn in cyan over both
sides so the imagery has a referent.

**It is not a flood before/after, and the UI says so on screen.** The 6 Oct scene is the only optical image of the
valley after the event, and it is roughly **half obscured by cloud** and was taken **eight days after the
27–28 Sep peak**, by which time the water had receded. Maxar Open Data is **CC BY-NC 4.0 — non-commercial**.

**No independent satellite ground truth exists for this valley.** Copernicus EMS never activated for the event, and
every Copernicus GFM Sentinel-1 pass between 27 Sep and 7 Oct reports **zero flood pixels** over the valley while
UNOSAT's optical product mapped 112 polygons there — SAR cannot see flooding under dense urban cover. UNOSAT's own
affected-building layer is derived from the extent the model is *given*, so it cannot score the model either. That
leaves the 19 BIPAD reports as the only independent record, and they bound how much any evaluation can conclude.

---

## Real vs mock

| In the console | Status |
|---|---|
| Road geometry (about 6,000 main-road segments plus the closed and stranded ones) | **Real**: OpenStreetMap, 2 Jan 2024 |
| Satellite base | **Real**: Esri World Imagery tiles (streamed), Sentinel-2 mosaic (bundled fallback) |
| 3D terrain | **Real**: public elevation tiles (streamed) |
| Hospital names and positions (6 shown) | **Real** names and positions from OSM. Access status (ok, degraded, lost) is **invented** |
| Airports (3) | **Tribhuvan International Airport** is placed at its real position (it sits on the runway in the imagery). Its role, status and the 2 helipads are **mock** |
| Army bases (3) | **Mock** sites, names and roles. Status is computed from distance to closures |
| Schools (16) | **Mock** sites and names. Risk is computed from the other mock fixtures |
| Which roads are closed (12 closures, 6 cut-off pockets) | **Illustrative.** Selected once from the engine's closed and stranded roads. The selection script is not in the repo |
| Rain forecast (weather agent) | **Mock**: a value you set, with range and intensity from a simple rule |
| Flood extent | **Real**: UNOSAT SPOT-6, observed 30 Sep 2024 |
| Flood depth | **Illustrative**: ordering from real elevation tiles (terrain agent), scale assumed |
| Terrain low-ground patches, rain cells | **Mock** (drawn) |
| Power outages (9 dark areas) | **Real, observed**: NASA Black Marble nightly lights. Cells whose lights fell below half of normal on clear nights 29 Sep to 2 Oct, against 19 Aug to 25 Sep (103 dark cells of 906 seen; 0.3% false-dark rate on ordinary nights). 28 Sep was clouded over. "Likely lost power", not confirmed |
| Landslide zones (4), public-alert zones (2) | **Mock** (drawn) |
| Cell sites (328, merged from 902 cells) | **Real positions** from OpenCelliD (crowd-sourced estimates; current database, `firstSeen` marks sites that may postdate the flood). Status is **modelled**: inside the observed flood extent = down; within 200 m of it, or in a night-lights dark cell = at risk |
| Regional internet connectivity (chart in the drawer for cell sites and pockets) | **Real**: IODA, Bagmati zone. Networks visible fell 24% at 07:45 on 28 Sep, Nepal time. Regional only |
| Dams (2), social posts (8), radio call-ins (6) | **Mock** |
| QRT staging (4), food depots (3), shelters (5) | **Mock** |
| Evidence text, recommended actions, headcounts, stock, households | **Mock** (generated from the fixtures) |

---

## Data sources and licences

| Source | Used for | Licence / terms | Caveats |
|---|---|---|---|
| **OpenStreetMap** via Geofabrik `nepal-240101.osm.pbf` (2 Jan 2024) | Pre-event road network, hospitals, place names | ODbL, © OpenStreetMap contributors | Snapshot is 9 months before the event, so new roads are missing. Speeds are assumed per road class. Service roads, tracks and paths are excluded. 185 "hospital" features include small clinics |
| **UNOSAT** SPOT-6 flood extent, product 3996 (`Spot6_20240930_FloodExtent_Kathmandu`, observed 30 Sep 2024) | Given hazard in the hindcast engine (not drawn in the ops console) | CC BY-SA | Optical extent is an analyst/algorithm product with its own error and cloud/urban limits. Product 3993 (also referenced in earlier notes) ships no Kathmandu layers |
| **BIPAD Portal** incident API, 26 Sep to 6 Oct 2024, verified, in the valley extent | Scoring only, never a model input | **Licence not stated on the API.** Confirm before redistributing | Ward-level report points. Missing report is not missing impact. Small sample. The data file is in this repo |
| **Sentinel-2 cloudless 2020** (EOX WMS), bundled as `assets/valley.jpg` | Offline fallback satellite base | CC BY-NC-SA 4.0 (non-commercial). Contains modified Copernicus Sentinel data | 10 m resolution, so soft when zoomed. Shown dimmed |
| **Esri World Imagery** tiles (Esri, Maxar, Earthstar Geographics) | Sharper streamed satellite base | Esri public tile service terms | Needs internet. Public service, no licensed key: check the terms before anything beyond a demo |
| **AWS Terrain Tiles** (Mapzen, terrarium encoding) | 3D terrain, hill-shading, and the terrain agent's elevation reads | Public dataset, attribution shown on the map | Needs internet. 3D only |
| **Maxar Open Data**, "Nepal Floods Sept 2024" collection | Identified (pre-event 13 Jan 2024, post-event 6 Oct 2024 scenes for the valley). **Not used in the app** | CC BY-NC 4.0 | The 6 Oct scene is heavily clouded over much of the valley. See [docs/real-data-findings.md](docs/real-data-findings.md) |
| **Google Photorealistic 3D Tiles** via Cesium ion (asset 2275207) | Optional photoreal close-up of a selected item | Cesium ion Community plan is free for personal and non-commercial use, capped at 1,000 root tiles a month. Google attribution is shown. Subject to the Google Maps Platform terms | Needs a Cesium ion token and internet. Check the plan terms before commercial use |
| **OpenCelliD** per-country download (MCC 429), via `scripts/fetch_opencellid.mjs` (needs `OPENCELLID_KEY` in `.env`) | Cell-site positions (`data/real/kathmandu/cell_sites.json`) | CC BY-SA 4.0, attribute OpenCelliD | Positions are estimates from phone reports. Database is current, not pre-event. Flood-time site status is not public |
| **NASA Black Marble** VNP46A2 v2 via `scripts/fetch_blackmarble.py` (needs `EARTHDATA_TOKEN`, an Earthdata Login token; downloads from the Earthdata Cloud mirror; ~1.4 GB of tiles cached outside the repo) | Power outages (`data/real/kathmandu/night_lights.json`) | NASA data, free with citation (doi:10.5067/VIIRS/VNP46A2.002) | Monsoon cloud: 28 Sep fully clouded, 26–27 Sep missing. Thin cloud can also dim lights |
| **IODA** (Georgia Tech) API, via `scripts/fetch_ioda.mjs` (no key) | Regional internet connectivity, 20 Sep to 5 Oct 2024 (`data/real/kathmandu/ioda.json`) | Free for research; credit IODA | Finest unit is the old Bagmati zone, so it shows when, not where |
| **Google Fonts** (Bricolage Grotesque, IBM Plex Sans/Mono) | UI typography | Open fonts | Loaded from the web. Falls back to system fonts offline |
| All other console inputs and outputs | Towers, weather, dams, social, radio, shelters, depots, QRT, outages, alerts, landslide zones | **Invented** for the demo | Clearly labelled DEMO DATA |

Data provenance for the hindcast files is in [data/real/kathmandu/provenance.json](data/real/kathmandu/provenance.json). Fuller notes: [docs/sources.md](docs/sources.md), [docs/real-data-findings.md](docs/real-data-findings.md), [docs/assumptions.md](docs/assumptions.md).

### Rebuilding the hindcast data

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

Download the Geofabrik snapshot and the UNOSAT product 3996 shapefile separately first (links in `docs/real-data-findings.md`).

---


## Repository layout

```
apps/api            Fastify API: /api/scene, /api/weather/*, /api/assessment, /api/tiles/*, /api/buildings, /api/helene/*, /api/hindcast/*
apps/web            React + Vite + MapLibre (ops console + Helene + hindcast modes)
packages/analysis   cascade.ts (Kathmandu) and replay.ts (Helene time-slicing, alert drafts)
packages/adapters   mock / openmeteo / osm / runoff / terrarium / tiles
packages/ports      shared DTOs and ports
data/real/helene    tims.json (NCDOT), network.json, tims_match.json, provenance.json
data/real/kathmandu derived Kathmandu data + buildings.json
scripts/            fetch_tims.mjs, prepare_helene.py, fetch_buildings.mjs, fetch_bipad.mjs, prepare_kathmandu.py
docs/               helene-data-audit, adapters, atmosphere design, hindcast-results, sources, demo-script
tests/              Vitest: cascade, hindcast, adapters, atmosphere, replay, shelter
```

Stack: TypeScript, React 19, Vite, MapLibre GL JS, Fastify, Zod, Vitest. No database.

Demo walk-through: [docs/demo-script.md](docs/demo-script.md).
