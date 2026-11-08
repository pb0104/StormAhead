# StormAhead

Helping people get through a disaster by answering two questions: **which roads can we still use, and where should resources go?** For two audiences — the **public** (alerts about closed or dangerous roads) and **authorities** (what's blocked, for quick-response teams and evacuation planning). AI agents combine data sources into one picture and *propose* actions; **a person approves before anything goes out.**

The app has three modes: **Kathmandu ops console** (authorities cascade console), **Hurricane Helene replay** (western NC), and the **Kathmandu hindcast** research view.

## Inspiration

Flood maps show where water is. The expensive failures are what happens next: a road that closes, a ward that loses hospital access, a shelter that looks open until you check the only way in. After Kathmandu's September 2024 floods and Helene in western North Carolina, those knock-on effects were spread across separate tools. Analysts had too little time to fuse them by hand.

We wanted one ops picture where specialist agents each watch a feed, a shared layer stacks their findings, and a person still approves every draft alert or resource move.

## What it does

StormAhead is a map-first operations console for flood response. It answers: which roads still work, and where should help go?

Specialist agents run in parallel on rain, rivers, terrain, roads, cell sites, power, social posts, facilities, and landslides. The coordinator turns overlapping flags into combined findings (Priority 1 / 2) with evidence. A briefing agent drafts the sitrep and bilingual public alert. ORACLE is the spoken ops desk: it reads agent output, the map, and the evaluation pack, then briefs in plain language.

Nothing sends automatically. Assign, issue, approve, and reject only change the console until a human confirms.

The default screen is the Kathmandu forecast console on the September 2024 valley event. Helene replay and the hindcast research view are also in the app. Evaluation (Details → Evaluation) scores knock-ons against withheld BIPAD reports and a five-pillar LLM council: right place, knock-ons, false alarms, evidence, and decision-ready.

## How we built it

TypeScript end to end: Fastify API, React + Vite web, MapLibre on the map. Agents live under `apps/api/forecast/`; the shared event shape and cascade / ward scoring sit in `packages/analysis`. Public feeds (BIPAD, DHM, OSM, UNOSAT, Maxar Open Data, OpenCelliD, Black Marble, Reddit via Arctic Shift, Open-Meteo) are cached locally so the replay does not depend on live APIs during a pitch.

LLM text goes through StackAI when configured; otherwise agents fall back to rule-written summaries and say so. Voice uses Vertex Gemini Live or OpenAI Realtime through a local proxy. ORACLE tools call the same console actions an operator clicks.

## Challenges we ran into

Ground truth for urban flooding is thin. SAR products over the valley reported zero flood pixels while UNOSAT mapped water optically. BIPAD impact reports for scoring are few (ward-level, small n). Early point-radius tests looked strong until random baselines matched them; we moved to ward scorecards and an explicit evaluation pack so false alarms count.

Keeping "generate" and "grade" separate mattered: after imagery and BIPAD reports score the run; they are not fed into the live agents. Radio scanner feeds were off-limits under their terms, so the console uses listen-only broadcast radio instead. Live voice APIs changed shape mid-build (Realtime GA); we adjusted the session protocol rather than freeze the feature.

## Accomplishments that we're proud of

- A working map console where agents run in parallel, fuse into combined findings, and leave every action behind a human gate.
- ORACLE as a single spoken channel that can brief evaluation, fly the map, log actions, and tune listen-only radio.
- Real Kathmandu layers wired in: gauges, facilities, flood extent, buildings, night lights, cell sites, social posts, before/after Maxar.
- An Evaluation tab with five council pillars and six ground-truth metrics from the hindcast, not a separate slide deck.
- Helene road-restriction replay with human approve/reject on public alert drafts.

## What we learned

Stacked agents beat a single feed when the claim is a knock-on, not the flood footprint itself. Scoring needs baselines; a high hit rate alone is not evidence. Operators need short briefs and a reject button more than another chart. Caching public disaster data locally is what makes a weekend pitch reliable.

## What's next for Storm Ahead

- Road-closure prediction scored against NCDOT / USGS records with clear baselines (Helene track).
- Resource allocation against live stock and routing, still with human approval.
- Optional Informer Apps companion for leadership scorecards (Entrinsik challenge path).
- Sharper hospital and critical-facility coverage so access loss reads clearly on the map.
- Feed approved and rejected drafts back into Verification and Memory.

## Built With

- TypeScript, Node.js 22+, React 19, Vite, MapLibre GL JS
- Fastify, Zod, Vitest, tsx
- StackAI (LLM flows), Vertex Gemini Live / OpenAI Realtime (voice)
- BIPAD, DHM gauges, OpenStreetMap, UNOSAT SPOT-6, Maxar Open Data
- OpenCelliD, NASA Black Marble, IODA, Open-Meteo, Reddit (Arctic Shift), Radio Browser

The Kathmandu ops console loads scene, weather seed, terrain/flow assessment and map tiles from a **modular adapter API** (`/api/scene`, `/api/weather/seed`, `/api/assessment`, `/api/tiles/*`). Weather can use Open-Meteo (`WEATHER_ADAPTER=openmeteo`). See [docs/adapters.md](docs/adapters.md). Building footprints come from `GET /api/buildings`.

> In the ops console and Helene public drafts, nothing is sent — assign/approve only changes the screen.

---

## Forecast console (the default screen)

The app opens on a full-screen map with one prompt. The operator asks a question ("How do the next 15 days look?"), picks which factors to include, and watches the matching agents work **in parallel**. Each one streams its steps on real data, then reasons over its own numbers with an LLM. When they finish, a coordinator fuses their alerts into **combined findings** (places several agents flag together, ranked P1/P2). A briefing agent writes the situation report: what will be affected, how to prepare, resource allocation and a bilingual public alert. The map then plays the window back, with animated rain driven by the hourly gauges, flood water and runoff, road closures, outages and pulsing alert pins. **The report is a draft: approving it changes the screen only. Nothing is sent.**

| Factor (agent) | Reads |
|---|---|
| Weather | 17 DHM rain gauges, hourly (BIPAD); Open-Meteo ECMWF cross-check |
| River gauges | 13 DHM river stations: warning and danger crossings |
| Terrain & flooding | Elevation tiles + runoff model via `/api/assessment`, driven by the window's heaviest 24 h |
| Satellite | UNOSAT SPOT-6 extent, Maxar footprints, Black Marble coverage |
| Roads & access | OSM network closure rule, cut-off pockets, hospital access |
| Cellular | OpenCelliD sites near water; IODA regional drop |
| Power grid | NASA Black Marble dark areas |
| Social media | Reddit posts in the window, located help requests inside the valley |
| Facilities & shelter | BIPAD hospitals, schools, open spaces, responders; Google care homes |
| Landslides | BIPAD landslides 2021–2023 (2024 withheld) + a 100 mm/24 h trigger rule of thumb |

**Replay rule.** The scenario clock is fixed at 26 Sep 2024 06:00 NPT, before the floods. Values inside the forecast window are what was actually observed, used as a perfect-forecast stand-in. The UI says so on the clock chip, in the report and in every agent's caveats. Coordinates always come from data; the LLM only writes text.

**LLM (StackAI).** StackAI runs a deployed *flow*, so it needs three values in the repo-root `.env`: `STACKAI_API_KEY`, `STACKAI_ORG_ID` and `STACKAI_FLOW_ID`. The flow should be Input (`in-0`) → LLM (prompt `{in-0}`) → Output (`out-0`); the org and flow IDs are in its Export → API snippet. Every prompt is self-contained. Without them, the agents and the report fall back to rule-written summaries that are labelled as such. Code: `apps/api/forecast/` (`agents.ts`, `service.ts`, `stackai.ts`); UI: `apps/web/src/forecast/`. Endpoints: `GET /api/forecast/factors`, `POST /api/forecast/intent`, `POST /api/forecast/run` (server-sent events).

**Rising water.** When the forecast plays back, water rises and drains gradually instead of jumping between stages. Flood depth is the assessed depth × a water level from a simple linear reservoir on the hourly gauge rain (~30 h drain time; rain–elevation depth model), evaluated on the GPU so shallow patches stay dry until the level reaches them and the wet area spreads. The valley's rivers (OpenStreetMap, `data/real/kathmandu/rivers.geojson`, from `scripts/fetch_rivers.mjs`) widen, brighten and run faster with the **real hourly river stage**: the river agent picks the gauge with the most readings in the window (Bagmati at Gaurighat for Sep 2024) and interpolates only between readings. A gauge that stops reporting while above danger is reported as a finding: Bagmati at Khokana went silent at 05:00 on 28 Sep reading 6.2 m. Road closures and cut-off pockets follow the same water level. The timeline draws the water curve behind the rain bars and reads out the level and gauge stage under the play head.

**Base imagery.** Google 2D satellite tiles (Map Tiles API) are the default base when `GOOGLE_MAPS_API_KEY` has the Map Tiles API enabled: native zoom 20 over the valley, against Esri's 18 here, and newer, less shadowed imagery. The server proxies them (`/api/tiles/google/{z}/{x}/{y}`) so the key never reaches the browser, renews the tile session, caches tiles in memory only (Google's terms rule out disk caching), and stops at a daily budget (`GOOGLE_TILES_DAILY_BUDGET`, default 25,000). Esri stays underneath, disk-cached, so offline or over budget the map still has imagery. Google imagery is shown unaltered with the Google logo and the copyright for the current view. **Layers → Base imagery** switches between Google and Esri; the choice is remembered.

**Analyst action updates.** Most real updates arrive by phone or radio, so logging one is a sentence, not a form. Switch the chat box to **Update** (or just type a report; it's detected) and write what happened, e.g. "Sent QRT-2 to Balkhu, 40 people moved to Kalimati open space". The LLM turns it into structured actions; place names are matched to real entries (OSM places, BIPAD open spaces, wards, hospitals, schools, named buildings), never to LLM coordinates; an unknown name can be picked on the map. The analyst confirms a one-line summary, and the action is saved to that location's history (`data/runtime/actions.json`, gitignored). The map labels the place ("QRT-2 sent · 14:20 · 40 evacuated"), and the **Actions** panel lists the history with undo. **An action never closes a location.** It gives the recommender context: if help is there but people likely remain, it suggests more for the same place ("QRT-2 is at Balkhu, but about 240 people may still need help there. Send another team?"); if the place looks covered, it points to the next flagged area where nothing has been done yet. Forecast runs use the log too: combined findings carry *No action yet / help on site / looks covered* badges, uncovered places rank first within each priority, and the report is told what is already on the ground. "People remaining" is an **estimate**: 2021 census density by municipality × ground the 2024 flood covered within 0.75 km, minus people logged as moved. It is an upper bound, and where nothing flooded it gives no figure. **Each forecast run starts a clean action log:** actions are tagged with their run, and starting a new run hides the previous run's actions from the map, panel, coverage, recommendations and report (they stay in `actions.json` for audit). **ORACLE can manage actions by voice or text:** `list_actions`, `log_action` (parses and shows the one-line confirmation, doesn't save), `confirm_action_update` (saves, only with `confirmed=true` after the operator agrees), `cancel_action_update`, `edit_action` (changed place names are re-matched; unknown names are refused) and `remove_action` (needs `confirmed=true`). Endpoints: `POST /api/actions/parse`, `POST /api/actions`, `GET /api/actions`, `PATCH /api/actions/:id`, `DELETE /api/actions/:id`, `POST /api/actions/coverage`. `STORMAHEAD_RUNTIME_DIR` points the log somewhere else (used for tests).

**Live radio.** The **Radio** button opens live broadcast stations in Nepal (Radio Nepal, BBC Nepali, Kantipur FM and about 130 more), grouped as News, Kathmandu and All. The three stations with a known position in the valley also appear as map pins; tap one to play it. The approach follows gods-eye-view: the server only fetches and caches the station list from the **Radio Browser** directory (public domain, PDDL 1.0; `GET /api/radio/stations`, cached 45 min in memory and in `data/cache/radio/`). Pressing play connects the browser straight to the broadcaster's own HTTPS stream. StormAhead never proxies, records or transcribes audio, and none of it reaches the agents. This is radio **as of today**, not part of the 2024 replay, and it is broadcast news/FM, not emergency-services traffic (scanner feeds forbid this use; see the Radio notes in `CLAUDE.md`). Each broadcaster's stream terms apply.

The earlier map-first ops console (`OpsConsole.tsx`) is kept but not mounted. Export it from `App.tsx` to bring it back.

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
4. Assign or issue those actions as authority actions in the console (local screen state, with undo).

Audience: authorities only. There is no public view.

---

## The ops console

### Layout

- **Map (hero).** Full-bleed MapLibre map, no basemap provider key. Base is satellite imagery with the OSM road network on top.
- **Command rail (left, collapsible).** Wordmark and one line of context, a scenario and time selector (Now, +6 h, Peak +12 h; later stages reveal more closures), the **Run cascade assessment** button, and compact toggles:
  - *Inputs:* Terrain, Road network, Cell towers, Weather, Atmosphere, Dams, Hospitals, Schools, Airports, Helipads, Army bases.
  - *Outputs:* Road closures, Flooding, Runoff flow, **Shelter & evacuate**, Landslides, QRT staging, Food, Shelter, Outages.
  - A legend that shows four symbols by default and the full set on request.
- **Status strip (top).** Up to seven counts (closed roads, cut-off pockets, landslide zones, schools at risk, hospitals at risk, grid outages, and buildings to evacuate when the real building layer is loaded). They are **filters**: clicking one zooms to that category's affected area, lights up the affected roads in the category's colour and dims everything else. If you click one before running the assessment, it runs the assessment first. Also holds the **2D / 3D** toggle, and the **Details** link.
- **Context drawer (right, bottom sheet on small screens).** Opens only when you select something on the map. Sections: *What failed, and why* and *Recommended response*. Response cards are the only cards in the UI, and each is assignable.
- **Details dialog.** Sources and a log of console actions. This is the only place secondary information lives.

### Behaviours worth knowing

- **Flooding is animated water with depth.** After a run, the real UNOSAT observed flood extent (30 Sep 2024) is drawn as rippling water, coloured by depth (light is shallow, dark is deep). Depth comes from a **weather agent** (forecast rain you set with the slider or the 6, 10 and 15 inch presets) and a **terrain agent** (reads real elevation tiles in your browser and ranks each flood patch by how low it sits). Depth scales linearly with rain, the deepest patch is set to 2.4 m at a 10 inch reference (an assumption), patches under 0.2 m show dry, and the time selector applies 40%, 75% and 100% of the forecast rain. It can only show less water than the observed extent, or deeper water inside it, never a larger area. In the photoreal close-up the water is an animated surface raised by that depth. The extent itself is an optical product that likely under-detects urban flooding. Hover a patch for its depth.
- **Runoff flows downhill and pools.** A **flow agent** routes the forecast rain over a 70 m elevation grid built from the same real elevation tiles: water drains off slopes and collects in channels and low ground. Pooled water is drawn in blue, with a modest number of slow streaks that follow the slope, mostly along the main channels (computed by D8 flow accumulation), drawn at screen resolution at a fixed gentle speed. It is a teaching model: no drainage network, soil or buildings, the grid edge is an outlet, and the headline depth is the median of the wet cells because single noisy elevation pits can hold unrealistically deep water. It is separate from the observed-extent flooding above and uses the Rain forecast slider and time selector.
- **Shelter and evacuation, on real buildings.** After a run, 7,115 **real** pre-event OSM building footprints (2 Jan 2024, the same snapshot as the roads) are drawn and coloured by what to do with them: red to evacuate, amber to shelter on the upper floors, green where a dry upper-floor building inside a cut-off area can take people in, grey where OpenStreetMap has no height so **no judgement is offered**. The reading is depth-driven: the terrain and weather agents give each flood patch a depth, a building loses one floor per 3 m of water, and the verdict changes as you move the rain slider or the time selector. Capacity assumes 3.5 m² per person (Sphere) over 70% of the footprint — an order-of-magnitude figure, not a survey. In 3D the footprints are extruded by their **tagged** storey count. Buildings that are dry, reachable and unremarkable are not drawn. The layer is fetched from the API; without it the rest of the console is unchanged.
- **Zoom to affected areas.** Strip filters fit the map to the affected features. Affected roads per category: closed roads → the closed segments; cut-off pockets → the stranded roads; landslide zones and grid outages → the main roads (trunk to tertiary) that run through each zone; hospitals at risk → the closures within 3.5 km of those hospitals; schools at risk → the closures within 1.2 km of those schools. Selecting a single item also fits the map to it. Closures and cut-off pockets can recommend asking the nearest army base for engineers, boats or trucks, and pockets can recommend an airlift from an open airport or helipad.
- **Recommended responses** are computed from the resource network: the nearest QRT staging point, food depot with stock, shelter with free places, or outage feeder. The map draws dashed lines from the selection to the recommended resources.
- **2D / 3D.** 3D turns on terrain relief and hill-shading, tilts the camera and enables rotation. Roads, closures and zones drape over the terrain. 2D is flat and works offline.
- **Building types have their own icons.** Hospital (cross), school (house), airport or helipad (plane), army base (star), shelter (tent), food depot (crate) and QRT staging (shield), drawn in `icons.ts` and reused as inline SVG in the legend and drawer. The ring colour shows state (green ok, amber at risk or degraded, red high risk or access lost) and at-risk buildings carry a "!" badge. **Schools** are annotated with risk, computed from distance to landslide zones, closed roads and outage areas, and their drawer offers student evacuation, a hold-on-site order, shelter and an alert.
- **Photoreal close-up (optional).** The drawer has **View in photoreal**, which opens just the selected item (and optionally the resources it links to) over Google Photorealistic 3D Tiles using CesiumJS. It needs a free Cesium ion token: put `VITE_CESIUM_TOKEN=...` in `apps/web/.env.local` (gitignored) or paste it into the prompt, which stores it in the browser only. Cesium loads from a CDN only when you open it. The first tiles take a few seconds to stream. Without a token, the rest of the console works unchanged.
- **Motion** is limited to three things: the staged reveal of closures, the drawer slide-in, and the count change in the status strip. `prefers-reduced-motion` turns them off.

### Code map (`apps/web/src`)

| File | Role |
|---|---|
| `App.tsx` | State and orchestration: run animation, filters, selection, console actions |
| `MapStage.tsx` | MapLibre map: layers, reveal, filtering, selection, zoom-to-affected, 2D/3D |
| `CommandRail.tsx`, `StatusStrip.tsx`, `ContextDrawer.tsx`, `DetailsDialog.tsx` | The four UI surfaces |
| `buildings.ts` | **Real** building footprints: fetch, depth join, shelter/evacuate reading |
| `scene/data.ts` | Scene entities, GeoJSON, affected-roads helper |
| `scene/advice.ts` | Evidence and recommended actions per entity kind |
| `icons.ts`, `Glyph.tsx` | Per-building-type icon shapes for the map (canvas) and UI (SVG) |
| `scene/network.json` | Fixture: OSM road geometry plus the selected closures and pockets |
| `assets/valley.jpg` | Bundled Sentinel-2 mosaic, the offline fallback base |
| `styles.css` | Console styles |
| `HindcastView.tsx`, `hindcast.css`, `api.ts` | The earlier research view of the real hindcast. **Kept, but not rendered.** Render `<HindcastView />` from `App.tsx` to bring it back |

---

## The Engine

Lives in `packages/analysis/cascade.ts`, served by `apps/api`. It is deterministic and rule-based. The activity feed shows real tool calls, never presented as LLM reasoning.

**Question.** Given the flood (UNOSAT observed extent, 30 Sep 2024, a *given input*, not predicted), can we predict knock-on impacts that the flood map alone does not show, using only a **pre-event** road network?

**Steps** (`HindcastService.run` in `apps/api/hindcast.ts`):

1. **Coordinator**: asserts the road snapshot predates the event (`assertNetworkPreEvent`), so the pre-event claim cannot be silently false. The observed extent is used only as the hazard. Incident reports are withheld.
2. **Hazard Agent**: loads the observed flood extent.
3. **Infrastructure Agent**: closes roads by an adjustable rule: a bridge touching the flood, or at least `closeShare` (default 30%) of the road's length flooded. *Exposed does not mean closed.*
4. **Access Agent** (`analyzeCascade`): multi-source Dijkstra from open hospitals on the full network and on the network with closures. Reports dry places that lose all hospital access (*isolated*) or whose trip gets at least +10 min and at least 1.5× slower (*degraded*), and dry open roads cut off from the main network (*stranded*). A flooded hospital counts as unavailable.
5. **Shelter Agent**: reads 7,115 pre-event OSM building footprints (shelter-relevant types) and gives each a shelter reading — flooded with floors above the water (shelter in place), flooded with none (evacuate), or a dry upper-floor building inside a cut-off area (local refuge). A building with no usable `building:levels` gets **no judgement**, never a guessed height.
6. **Verification Agent**: scores afterwards against withheld BIPAD reports, two ways. (a) `scoreAgainstIncidents` — the point test, with a random baseline (permutation test, 2,000 sets), a nearest-the-flood baseline, and sensitivity to the closure threshold and match radius; landslides scored separately as an out-of-model check. (b) `scoreByWard` — a per-agent scorecard over 203 ward polygons (hits, false alarms, precision, recall, F1 vs random baselines), with the given hazard as the bar to beat. Live pack: **Details → Evaluation** and `GET /api/evaluation`.

**API** (Fastify, `apps/api/server.ts`): `GET /api/health`, `GET /api/hindcast/meta`, `GET /api/hindcast/geo`, `GET /api/buildings` (real footprints for the console), `GET /api/scorecard` (the per-agent evaluation, cached), `GET /api/evaluation` (five-pillar council + metrics), `GET /api/verification` (the same scorecard as map geometry), `POST /api/hindcast/run` (optional body: `closeShare`, `bridgeClosesOnAnyContact`, `degradeMinutes`, `degradeRatio`). Agent events are in the run response. The server also serves the built web app from `apps/web/dist`.

**Spatial pre-computation** (per-road flooded share, per-place in-flood flag and distance to flood) is done offline by `scripts/prepare_kathmandu.py` and committed as derived data. The impact reasoning itself is all in TypeScript.

### Before / after imagery

**Before / after imagery** in the command rail swipes between two Maxar Open Data mosaics, 13 Jan 2024 and 6 Oct 2024, built by `scripts/build_maxar_mosaics.py`. The observed UNOSAT footprint is drawn in cyan over both sides.

**How Maxar is ground truth.** Live agents never see the after mosaic or the BIPAD impact file — those are held for grading. The evaluation pack treats Maxar as the optical change record for the valley: where the 6 Oct scene is clear, before/after tiles show what actually changed on the ground after the September flood; the council and the geographic checks use that change, with UNOSAT (wet extent on 30 Sep) and withheld BIPAD ward reports, to score whether flags landed in the right places. Cloudy tiles are simply out of the visual check; they do not invent flood polygons. Maxar Open Data is **CC BY-NC 4.0**.

### Evaluation results

From **Details → Evaluation** (`GET /api/evaluation`) on the Kathmandu Sep 2024 run. Method: three-judge LLM council (Gemini, GPT, Claude) on five pillars, plus metrics computed from UNOSAT extent, Maxar before/after, and withheld BIPAD reports.

**Council overall: 4.8 / 5**

| Pillar | Score | What it asks |
|---|---|---|
| Right place | 4.8 | Did we flag the areas that actually got hit? |
| Knock-on effects | 4.7 | Beyond flooding, did we catch cut-offs and access loss? |
| Not crying wolf | 4.6 | Did we avoid flooding the board with empty alarms? |
| Show your work | 4.8 | Can every claim be traced to a real source? |
| Ready for a decision | 4.9 | Could a manager approve or reject the next step in one glance? |

| Metric | Value |
|---|---|
| Impact wards caught | 90% (9 of 10 BIPAD impact wards) |
| Knock-on coverage (1 km) | 84% (16 of 19 reports outside the flood polygon) |
| Wards correctly left quiet | 38% (77 of 203 true negatives) |
| Infrastructure agent vs chance | p = 0.030 (59 wards flagged, 6 hits) |
| Shelter agent precision | 20% (2 hits of 10 flags) |
| Pre-event road network | 269 days before peak (OSM 2024-01-02) |

Ground-truth stack used for that grade: UNOSAT SPOT-6 (30 Sep), Maxar before/after (13 Jan / 6 Oct), BIPAD verified impact reports (withheld), pre-event OSM network as model input only.

---

## Data provenance

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

---

## Data sources and licences

| Source | Used for | Licence / terms | Caveats |
|---|---|---|---|
| **OpenStreetMap** via Geofabrik `nepal-240101.osm.pbf` (2 Jan 2024) | Pre-event road network, hospitals, place names | ODbL, © OpenStreetMap contributors | Snapshot is 9 months before the event, so new roads are missing. Speeds are assumed per road class. Service roads, tracks and paths are excluded. 185 "hospital" features include small clinics |
| **UNOSAT** SPOT-6 flood extent, product 3996 (`Spot6_20240930_FloodExtent_Kathmandu`, observed 30 Sep 2024) | Given hazard in the hindcast engine (not drawn in the ops console) | CC BY-SA | Optical extent is an analyst/algorithm product with its own error and cloud/urban limits. Product 3993 (also referenced in earlier notes) ships no Kathmandu layers |
| **BIPAD Portal** incident API, 26 Sep to 6 Oct 2024, verified, in the valley extent | Scoring only, never a model input | **Licence not stated on the API.** Confirm before redistributing | Ward-level report points. Missing report is not missing impact. Small sample. The data file is in this repo |
| **Sentinel-2 cloudless 2020** (EOX WMS), bundled as `assets/valley.jpg` | Offline fallback satellite base | CC BY-NC-SA 4.0 (non-commercial). Contains modified Copernicus Sentinel data | 10 m resolution, so soft when zoomed. Shown dimmed |
| **Esri World Imagery** tiles (Esri, Maxar, Earthstar Geographics) | Sharper streamed satellite base | Esri public tile service terms | Needs internet. Public service, no licensed key: check the terms before redistribution |
| **AWS Terrain Tiles** (Mapzen, terrarium encoding) | 3D terrain, hill-shading, and the terrain agent's elevation reads | Public dataset, attribution shown on the map | Needs internet. 3D only |
| **Maxar Open Data**, "Nepal Floods Sept 2024" collection | **Used**: before/after mosaics in the command rail + evaluation ground truth (clear-sky visual change); STAC footprints on the map / satellite agent | CC BY-NC 4.0 | 6 Oct is partly cloudy and post-peak; clear tiles grade change, cloudy tiles are skipped. See [docs/real-data-findings.md](docs/real-data-findings.md) |
| **Google Photorealistic 3D Tiles** via Cesium ion (asset 2275207) | Optional photoreal close-up of a selected item | Cesium ion Community plan is free for personal and non-commercial use, capped at 1,000 root tiles a month. Google attribution is shown. Subject to the Google Maps Platform terms | Needs a Cesium ion token and internet. Check the plan terms before commercial use |
| **OpenCelliD** per-country download (MCC 429), via `scripts/fetch_opencellid.mjs` (needs `OPENCELLID_KEY` in `.env`) | Cell-site positions (`data/real/kathmandu/cell_sites.json`) | CC BY-SA 4.0, attribute OpenCelliD | Positions are estimates from phone reports. Database is current, not pre-event. Flood-time site status is not public |
| **NASA Black Marble** VNP46A2 v2 via `scripts/fetch_blackmarble.py` (needs `EARTHDATA_TOKEN`, an Earthdata Login token; downloads from the Earthdata Cloud mirror; ~1.4 GB of tiles cached outside the repo) | Power outages (`data/real/kathmandu/night_lights.json`) | NASA data, free with citation (doi:10.5067/VIIRS/VNP46A2.002) | Monsoon cloud: 28 Sep fully clouded, 26–27 Sep missing. Thin cloud can also dim lights |
| **IODA** (Georgia Tech) API, via `scripts/fetch_ioda.mjs` (no key) | Regional internet connectivity, 20 Sep to 5 Oct 2024 (`data/real/kathmandu/ioda.json`) | Free for research; credit IODA | Finest unit is the old Bagmati zone, so it shows when, not where |
| **Google Fonts** (Bricolage Grotesque, IBM Plex Sans/Mono) | UI typography | Open fonts | Loaded from the web. Falls back to system fonts offline |
| Other operational layers | Towers, weather, shelters, depots, QRT, outages, alerts, landslide zones | Public feeds where available | See Details → Sources |

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

Stack: TypeScript, React 19, Vite, MapLibre GL JS, Fastify, Zod, Vitest. No database.

Walk-through: [docs/pitch-script.md](docs/pitch-script.md) (pitch script).
