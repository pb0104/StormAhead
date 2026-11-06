# Assumptions and limitations

- **Hindcast, not forecast.** The observed UNOSAT flood extent is the given hazard (post-event data, used only for that). The road network is pre-event (OSM 2024-01-02). Incident reports are used only for scoring, after prediction; a test verifies the prediction is independent of them.
- **Closure rule (assumption):** a road is closed if a bridge touches the flood, or ≥ closeShare (default 30%) of its length is flooded. Exposed ≠ closed. Sensitivity at 10/30/50% is reported.
- **Speeds (assumption):** free-flow per highway class (motorway 60 … residential 15 km/h); roads undirected; identical coordinates = same node; service roads/tracks/paths excluded.
- **Cascade definition:** dry place with no (or ≥ +10 min and ≥ 1.5× slower) access to an available hospital; flooded hospitals are unavailable; "stranded" = dry open road cut off from the main network.
- **"Hospital" = OSM `amenity=hospital`** (185 features, many small clinics) — hospital access therefore rarely breaks.
- **Scoring:** primary set = verified BIPAD incidents, 26 Sep–6 Oct 2024, hazard Flood/Inundation/Heavy Rainfall, with reported impact (19). Match radius 1000 m, in-flood buffer 100 m. Must beat a same-size random set (permutation, p < 0.05) AND a same-size nearest-the-flood set. Landslides scored separately (no landslide physics). Radius sensitivity was added after seeing results and is labelled exploratory.
- **Ground truth limits:** BIPAD points are ward-level reports; absence of a report ≠ no impact; the optical flood extent likely under-detects urban flooding (no report lies inside it); 19 incidents is small.
- Not modelled: power, telecom, landslides, congestion, debris, flood timing.
