# Assumptions and limitations

- **Hindcast, not forecast.** The observed UNOSAT flood extent is the given hazard (post-event data, used only for that). The road network is pre-event (OSM 2024-01-02). Incident reports are used only for scoring, after prediction; a test verifies the prediction is independent of them.
- **Closure rule (assumption):** a road is closed if a bridge touches the flood, or ≥ closeShare (default 30%) of its length is flooded. Exposed ≠ closed. Sensitivity at 10/30/50% is reported.
- **Speeds (assumption):** free-flow per highway class (motorway 60 … residential 15 km/h); roads undirected; identical coordinates = same node; service roads/tracks/paths excluded.
- **Cascade definition:** dry place with no (or ≥ +10 min and ≥ 1.5× slower) access to an available hospital; flooded hospitals are unavailable; "stranded" = dry open road cut off from the main network.
- **"Hospital" = OSM `amenity=hospital`** (185 features, many small clinics) — hospital access therefore rarely breaks.
- **Scoring:** primary set = verified BIPAD incidents, 26 Sep–6 Oct 2024, hazard Flood/Inundation/Heavy Rainfall, with reported impact (19). Match radius 1000 m, in-flood buffer 100 m. Must beat a same-size random set (permutation, p < 0.05) AND a same-size nearest-the-flood set. Landslides scored separately (no landslide physics). Radius sensitivity was added after seeing results and is labelled exploratory.
- **Ground truth limits:** BIPAD points are ward-level reports; absence of a report ≠ no impact; the optical flood extent likely under-detects urban flooding (no report lies inside it); 19 incidents is small.
- **Buildings (assumption-heavy).** 7,115 pre-event OSM footprints, shelter-relevant types only (`school`, `hospital`, `commercial`, `apartments`, …), fetched at the same 2024-01-02 snapshot date as the roads. Chosen because `building:levels` is tagged on ~80% of them but only ~4.8% of all ~357k buildings in the box, so the full set could not support a height judgement.
  - **Floor counts are missing on 20% (1,391 buildings).** Those get `floors: null` and **no** shelter judgement. A missing height is never replaced by a guess, because the output is "send people upstairs" or "move them out".
  - Counts above 60 storeys are treated as tagging errors (the box contains one tagged 1,234).
  - **A flooded building is assumed to lose exactly one floor.** The engine's hazard is binary (in / out of the observed extent), so it cannot distinguish 0.3 m from 3 m of water. This is the optimistic case.
  - **Capacity = footprint area × 0.7 usable × floors ÷ 3.5 m² per person** (Sphere minimum covered area). Footprint area is not usable floor area; 0.7 is assumed, not measured. Capacity is an order-of-magnitude figure.
  - Buildings mapped as OSM multipolygon relations are excluded (ways only). Only 709 of 7,115 carry a `name`.
  - Buildings are snapped to the nearest road-network node (median 40 m, max 538 m) to inherit access times.
- **Console shelter reading (`apps/web/src/buildings.ts`) is depth-driven**, unlike the engine's: a building loses one floor per **3 m** of water (assumed storey height), so the verdict moves with the rain slider and time selector. The depth itself is the console's illustrative model (ordering from real elevation tiles, absolute scale assumed), so the verdict inherits that uncertainty. A building with no tagged height is shown only where it is in the water or cut off, and never gets a verdict.
- **Buildings as cascade targets were tried and did not help** (run 2026-11-07, exploratory — the target set was chosen after the primary null result). See [hindcast-results.md](hindcast-results.md).
- Not modelled: power, telecom, landslides, congestion, debris, flood timing.
