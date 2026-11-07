# CascadeIQ

An operations console for **flood cascade impacts**: where roads close, what gets cut off because of it, and where an authority should send response. Built around the **Kathmandu valley, Sept 2024 floods**.

The repo holds two things that share one codebase:

1. **The ops console** (what you see at `http://127.0.0.1:3001`). A full-bleed 2D/3D map, a command rail, status-strip filters and a selection-driven drawer with simulated response actions. **Everything on it except the OpenStreetMap road geometry and the satellite base is mock or illustrative demo data.**
2. **The hindcast engine** (real data, scored honestly). Given the observed flood extent as an input, it works out which roads close, which dry places lose hospital access and which dry roads get stranded, then scores that prediction against independent incident reports it never saw. **Current result: no demonstrated predictive skill beyond baselines** (see [Honest hindcast result](#honest-hindcast-result)).

The console is a demo UI. It does not call the engine at run time: it draws a static fixture whose closed roads were derived once from the engine's output, plus invented inputs and outputs. The engine and its API are still in the repo and tested.

> Everything in the console is simulated. No real alert is sent, no team is dispatched, and "assigned" or "issued" only changes the screen.

---

## Run it

Requires Node ≥ 22.5. No API keys. The console streams some map tiles, so it needs internet for full detail (see [Data sources](#data-sources-and-licences)); without it the map falls back to a softer bundled satellite image.

```bash
npm install
npm start        # builds the web app, serves UI + API on http://127.0.0.1:3001
npm run dev      # hot reload: API :3001 + Vite :5173 (open http://localhost:5173)
npm test         # 20 tests (cascade engine + hindcast API)
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
  - *Inputs:* Terrain, Road network, Cell towers, Weather, Dams, Social media, Radio, Critical buildings.
  - *Outputs:* Road closures, Landslides, QRT staging, Food, Shelter, Outages, Public alerts.
  - A legend that shows four symbols by default and the full set on request.
- **Status strip (top).** Five counts (closed roads, cut-off pockets, landslide zones, hospitals at risk, grid outages). They are **filters**: clicking one zooms to that category's affected area, lights up the affected roads in the category's colour and dims everything else. If you click one before running the assessment, it runs the assessment first. Also holds the **2D / 3D** toggle, a "DEMO DATA" tag and the **Details** link.
- **Context drawer (right, bottom sheet on small screens).** Opens only when you select something on the map. Sections: *What failed, and why* and *Recommended response*. Response cards are the only cards in the UI, and each is assignable.
- **Details dialog.** Sources (real vs mock), assumptions, and a log of simulated actions. This is the only place secondary information lives.

### Behaviours worth knowing

- **Zoom to affected areas.** Strip filters fit the map to the affected features. Affected roads per category: closed roads → the closed segments; cut-off pockets → the stranded roads; landslide zones and grid outages → the main roads (trunk to tertiary) that run through each zone; hospitals at risk → the closures within 3.5 km of those hospitals. Selecting a single item also fits the map to it.
- **Recommended responses** are computed from the mock fixtures: the nearest QRT staging point, food depot with stock, shelter with free places, or outage feeder. The map draws dashed lines from the selection to the recommended resources.
- **2D / 3D.** 3D turns on terrain relief and hill-shading, tilts the camera and enables rotation. Roads, closures and zones drape over the terrain. 2D is flat and works offline.
- **Motion** is limited to three things: the staged reveal of closures, the drawer slide-in, and the count change in the status strip. `prefers-reduced-motion` turns them off.

### Code map (`apps/web/src`)

| File | Role |
|---|---|
| `App.tsx` | State and orchestration: run animation, filters, selection, simulated actions |
| `MapStage.tsx` | MapLibre map: layers, reveal, filtering, selection, zoom-to-affected, 2D/3D |
| `CommandRail.tsx`, `StatusStrip.tsx`, `ContextDrawer.tsx`, `DetailsDialog.tsx` | The four UI surfaces |
| `mock/demo.ts` | **Demo fixtures** (entities, GeoJSON, affected-roads helper) |
| `mock/advice.ts` | Invented evidence and recommended actions per entity kind |
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
5. **Verification Agent** (`scoreAgainstIncidents`): scores afterwards against BIPAD reports with a random baseline (permutation test, 2,000 sets), a nearest-the-flood baseline, and sensitivity to the closure threshold and match radius. Landslide incidents are scored separately as an out-of-model check.

**API** (Fastify, `apps/api/server.ts`): `GET /api/health`, `GET /api/hindcast/meta`, `GET /api/hindcast/geo`, `POST /api/hindcast/run` (optional body: `closeShare`, `bridgeClosesOnAnyContact`, `degradeMinutes`, `degradeRatio`). Agent events are in the run response. The server also serves the built web app from `apps/web/dist`.

**Spatial pre-computation** (per-road flooded share, per-place in-flood flag and distance to flood) is done offline by `scripts/prepare_kathmandu.py` and committed as derived data. The impact reasoning itself is all in TypeScript.

### Honest hindcast result

Run 2026-11-06 with default parameters. Full detail in [docs/hindcast-results.md](docs/hindcast-results.md).

| | |
|---|---|
| Road segments touching the flood / treated as closed | 462 / 310 (54 bridges), of 38,038 |
| Places directly flooded | 9 of 718 |
| Cascade: dry places with no hospital access / degraded | 1 / 0 |
| Cascade: dry roads stranded | 428 |
| Scored incidents (verified BIPAD flood/rain reports with impact) | 19, none inside the flood extent |
| Within 1,000 m of a predicted cascade item | 16 of 19 (84%) |
| Random same-size sets (mean) | 18.7 (p ≈ 1.0) |
| Nearest-the-flood baseline | 16 |

**Verdict: no demonstrated predictive skill.** The 84% headline is not evidence, because random sets of the same size do as well and the proximity baseline ties it. Exploratory checks (added after seeing the result, so not primary): at 250 m the model gets 0 of 19 against random 8.5, and at 500 m 7 of 19 against 15.9. The landslide check (15 of 17 against random 14.6, p ≈ 0.55) also shows no skill. Likely reasons are in the results doc: OSM lists 185 hospital features (many small clinics) so hospital access rarely breaks, stranded roads cluster while reports are spread, the optical flood extent probably under-detects urban flooding, and 19 incidents is a small sample.

---

## Real vs mock

| In the console | Status |
|---|---|
| Road geometry (about 6,000 main-road segments plus the closed and stranded ones) | **Real**: OpenStreetMap, 2 Jan 2024 |
| Satellite base | **Real**: Esri World Imagery tiles (streamed), Sentinel-2 mosaic (bundled fallback) |
| 3D terrain | **Real**: public elevation tiles (streamed) |
| Hospital names and positions (6 shown) | **Real** names and positions from OSM. Access status (ok, degraded, lost) is **invented** |
| Which roads are closed (12 closures, 6 cut-off pockets) | **Illustrative.** Selected once from the engine's closed and stranded roads. The selection script is not in the repo |
| Terrain low-ground patches, rain cells | **Mock** (drawn) |
| Landslide zones (4), grid outages (3), public-alert zones (2) | **Mock** (drawn) |
| Cell towers (16, 3 down), dams (2), social posts (8), radio call-ins (6) | **Mock** |
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
| **AWS Terrain Tiles** (Mapzen, terrarium encoding) | 3D terrain and hill-shading | Public dataset, attribution shown on the map | Needs internet. 3D only |
| **Maxar Open Data**, "Nepal Floods Sept 2024" collection | Identified (pre-event 13 Jan 2024, post-event 6 Oct 2024 scenes for the valley). **Not used in the app** | CC BY-NC 4.0 | The 6 Oct scene is heavily clouded over much of the valley. See [docs/real-data-findings.md](docs/real-data-findings.md) |
| **Google Fonts** (Bricolage Grotesque, IBM Plex Sans/Mono) | UI typography | Open fonts | Loaded from the web. Falls back to system fonts offline |
| All other console inputs and outputs | Towers, weather, dams, social, radio, shelters, depots, QRT, outages, alerts, landslide zones | **Invented** for the demo | Clearly labelled DEMO DATA |

Data provenance for the hindcast files is in [data/real/kathmandu/provenance.json](data/real/kathmandu/provenance.json). Fuller notes: [docs/sources.md](docs/sources.md), [docs/real-data-findings.md](docs/real-data-findings.md), [docs/assumptions.md](docs/assumptions.md).

### Rebuilding the hindcast data

The derived data under `data/real/kathmandu/` is committed. To rebuild it:

```bash
node scripts/fetch_bipad.mjs                     # incidents.json (evaluation only)
pip install -r scripts/requirements.txt
python -I scripts/prepare_kathmandu.py --osm nepal-240101.osm.pbf \
  --flood Spot6_20240930_FloodExtent_Kathmandu.shp --out data/real/kathmandu
```

Download the Geofabrik snapshot and the UNOSAT product 3996 shapefile separately first (links in `docs/real-data-findings.md`).

---

## Repository layout

```
apps/api            Fastify API: /api/health, /api/hindcast/{meta,geo,run}; serves apps/web/dist
apps/web            React + Vite + MapLibre ops console (see "Code map")
packages/analysis   cascade engine: heap Dijkstra, closures, cascade, scoring + baselines
packages/shared     agent event type
data/real/kathmandu derived data: network, places, flood extent, incidents, provenance
scripts/            fetch_bipad.mjs, prepare_kathmandu.py (rebuild the derived data)
docs/               hindcast-results, real-data-findings, assumptions, sources, demo-script
tests/              Vitest: cascade.test.ts, hindcast.test.ts
```

Stack: TypeScript, React 19, Vite, MapLibre GL JS, Fastify, Zod, Vitest. No database.

---

## Status and what's not done

- **Done:** the real-data hindcast engine and API (tested); the ops console UI with mock data, 2D/3D, status-strip zoom-to-affected, selection drawer and simulated actions.
- **Not done:** the console is not wired to the engine. Real power, telecom, dam, weather and social/radio feeds. Maxar imagery in the app. Better cascade targets (major hospitals, shelters, population). Landslide, power and telecom cascades. Why the hindcast shows no skill is still a set of untested hypotheses (see the results doc).
- **Removed earlier:** the synthetic-data staging planner (commit `7489b10`, "V1 demo").

Demo walk-through: [docs/demo-script.md](docs/demo-script.md).
