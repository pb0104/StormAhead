# Ops console

Audience: authorities only. There is no public view.

## Product story

Authorities see a flood map, but the costly surprises are the **knock-on effects**: roads and places that stay dry yet get cut off. The console tells that story in one screen:

1. Open the map: muted road network and hazard context (terrain low ground, rain).
2. Press **Run cascade assessment**. Closed roads are revealed one by one as the dominant red signal, then cut-off road pockets, landslide zones and grid outages.
3. Click a closure, pocket, landslide zone, hospital, tower, outage or alert zone. A drawer shows **what failed and why** (grouped by input) and **recommended response**: QRT evacuation, food, shelter, grid crew and a public-alert preview.
4. Assign or issue those actions as authority actions in the console (local screen state, with undo).

## Layout

- **Map (hero).** Full-bleed MapLibre map, no basemap provider key. Base is satellite imagery with the OSM road network on top.
- **Command rail (left, collapsible).** Wordmark and one line of context, a scenario and time selector (Now, +6 h, Peak +12 h; later stages reveal more closures), the **Run cascade assessment** button, and compact toggles:
  - *Inputs:* Terrain, Road network, Cell towers, Weather, Atmosphere, Dams, Hospitals, Schools, Airports, Helipads, Army bases.
  - *Outputs:* Road closures, Flooding, Runoff flow, **Shelter & evacuate**, Landslides, QRT staging, Food, Shelter, Outages.
  - A legend that shows four symbols by default and the full set on request.
- **Status strip (top).** Up to seven counts (closed roads, cut-off pockets, landslide zones, schools at risk, hospitals at risk, grid outages, and buildings to evacuate when the real building layer is loaded). They are **filters**: clicking one zooms to that category's affected area, lights up the affected roads in the category's colour and dims everything else. If you click one before running the assessment, it runs the assessment first. Also holds the **2D / 3D** toggle, and the **Details** link.
- **Context drawer (right, bottom sheet on small screens).** Opens only when you select something on the map. Sections: *What failed, and why* and *Recommended response*. Response cards are the only cards in the UI, and each is assignable.
- **Details dialog.** Sources and a log of console actions. This is the only place secondary information lives.

## Behaviours worth knowing

- **Flooding is animated water with depth.** After a run, the real UNOSAT observed flood extent (30 Sep 2024) is drawn as rippling water, coloured by depth (light is shallow, dark is deep). Depth comes from a **weather agent** (forecast rain you set with the slider or the 6, 10 and 15 inch presets) and a **terrain agent** (reads real elevation tiles in your browser and ranks each flood patch by how low it sits). Depth scales linearly with rain, the deepest patch is set to 2.4 m at a 10 inch reference (an assumption), patches under 0.2 m show dry, and the time selector applies 40%, 75% and 100% of the forecast rain. It can only show less water than the observed extent, or deeper water inside it, never a larger area. In the photoreal close-up the water is an animated surface raised by that depth. The extent itself is an optical product that likely under-detects urban flooding. Hover a patch for its depth.
- **Runoff flows downhill and pools.** A **flow agent** routes the forecast rain over a 70 m elevation grid built from the same real elevation tiles: water drains off slopes and collects in channels and low ground. Pooled water is drawn in blue, with a modest number of slow streaks that follow the slope, mostly along the main channels (computed by D8 flow accumulation), drawn at screen resolution at a fixed gentle speed. It is a teaching model: no drainage network, soil or buildings, the grid edge is an outlet, and the headline depth is the median of the wet cells because single noisy elevation pits can hold unrealistically deep water. It is separate from the observed-extent flooding above and uses the Rain forecast slider and time selector.
- **Shelter and evacuation, on real buildings.** After a run, 7,115 **real** pre-event OSM building footprints (2 Jan 2024, the same snapshot as the roads) are drawn and coloured by what to do with them: red to evacuate, amber to shelter on the upper floors, green where a dry upper-floor building inside a cut-off area can take people in, grey where OpenStreetMap has no height so **no judgement is offered**. The reading is depth-driven: the terrain and weather agents give each flood patch a depth, a building loses one floor per 3 m of water, and the verdict changes as you move the rain slider or the time selector. Capacity assumes 3.5 m² per person (Sphere) over 70% of the footprint — an order-of-magnitude figure, not a survey. In 3D the footprints are extruded by their **tagged** storey count. Buildings that are dry, reachable and unremarkable are not drawn. The layer is fetched from the API; without it the rest of the console is unchanged.
- **Zoom to affected areas.** Strip filters fit the map to the affected features. Affected roads per category: closed roads → the closed segments; cut-off pockets → the stranded roads; landslide zones and grid outages → the main roads (trunk to tertiary) that run through each zone; hospitals at risk → the closures within 3.5 km of those hospitals; schools at risk → the closures within 1.2 km of those schools. Selecting a single item also fits the map to it. Closures and cut-off pockets can recommend asking the nearest army base for engineers, boats or trucks, and pockets can recommend an airlift from an open airport or helipad.
- **Recommended responses** are computed from the resource network: the nearest QRT staging point, food depot with stock, shelter with free places, or outage feeder. The map draws dashed lines from the selection to the recommended resources.
- **2D / 3D.** 3D turns on terrain relief and hill-shading, tilts the camera and enables rotation. Roads, closures and zones drape over the terrain. 2D is flat and works offline.
- **Building types have their own icons.** Hospital (cross), school (house), airport or helipad (plane), army base (star), shelter (tent), food depot (crate) and QRT staging (shield), drawn in `icons.ts` and reused as inline SVG in the legend and drawer. The ring colour shows state (green ok, amber at risk or degraded, red high risk or access lost) and at-risk buildings carry a "!" badge. **Schools** are annotated with risk, computed from distance to landslide zones, closed roads and outage areas, and their drawer offers student evacuation, a hold-on-site order, shelter and an alert.
- **Photoreal close-up (optional).** The drawer has **View in photoreal**, which opens just the selected item (and optionally the resources it links to) over Google Photorealistic 3D Tiles using CesiumJS. It needs a free Cesium ion token: put `VITE_CESIUM_TOKEN=...` in `apps/web/.env.local` (gitignored) or paste it into the prompt, which stores it in the browser only. Cesium loads from a CDN only when you open it. The first tiles take a few seconds to stream. Without a token, the rest of the console works unchanged.
- **Motion** is limited to three things: the staged reveal of closures, the drawer slide-in, and the count change in the status strip. `prefers-reduced-motion` turns them off.

## Code map (`apps/web/src`)

| File | Role |
|---|---|
| `App.tsx` | State and orchestration: run animation, filters, selection, console actions |
| `MapStage.tsx` | MapLibre map: layers, reveal, filtering, selection, zoom-to-affected, 2D/3D |
| `CommandRail.tsx`, `StatusStrip.tsx`, `ContextDrawer.tsx`, `DetailsDialog.tsx` | The four UI surfaces |
| `buildings.ts` | **Real** building footprints: fetch, depth join, shelter/evacuate reading |
| `scene/data.ts` | Scene entities, GeoJSON, affected-roads helper |
| `scene/advice.ts` | Evidence and recommended actions per entity kind |
| `icons.ts`, `Glyph.tsx` | Per-building-type icon shapes for the map (canvas) and UI (SVG) |
| `scene/network.json` | Real OSM road geometry plus cascade closures and pockets on the observed flood |
| `assets/valley.jpg` | Bundled Sentinel-2 mosaic, the offline fallback base |
| `styles.css` | Console styles |
| `HindcastView.tsx`, `hindcast.css`, `api.ts` | The earlier research view of the real hindcast. **Kept, but not rendered.** Render `<HindcastView />` from `App.tsx` to bring it back |

> In the ops console and Helene public drafts, nothing is sent — assign/approve only changes the screen.

See also: [forecast-console.md](forecast-console.md), [engine.md](engine.md), [data-provenance.md](data-provenance.md).
