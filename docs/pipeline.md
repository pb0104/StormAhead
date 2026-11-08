# Forward pipeline

This pipeline detects flood and landslide risk from river gauges, rain and terrain. Unlike the hindcast, it uses no post-event imagery as input.

**Result (2026-11-06): it works as a same-day detector on held-out years. It gives no reliable next-day lead, and it cannot yet predict road closures.**

## Stages

| Stage | Input | Output | Code | Status |
|---|---|---|---|---|
| 1. Gauges | BIPAD/DHM hourly rain, river levels | Alert episodes at official levels | `packages/analysis/detect.ts` | Built |
| 2. Terrain | Copernicus GLO-30 elevation | HAND and slope per road and ward | `scripts/prepare_terrain.py` | Built |
| 3. Ward risk | Stages 1–2, census, incident labels | Flood and landslide risk per ward per day | `packages/analysis/risk.ts` | Built |
| 4. Roads and access | Stage 2, river level, cascade engine | Worst-case screen | `packages/analysis/forward.ts` | Partial |
| 5. Alerts | Stage 3, river level | Authority tier and public drafts | `alertLevel`, `apps/api/pipeline.ts` | Built, drafts only |
| 6. Verification | Withheld incidents | Scores against baselines | `scripts/run_pipeline_eval.ts` | Built |

`POST /api/pipeline/run` with `{ "date": "2024-09-28" }` runs every stage for one day, using data through the end of that day. Models train only on earlier years, and a test confirms that removing later incidents does not change the result.

The app's **Detect** mode shows this: run `npm start` and open http://127.0.0.1:3001. It has a ward risk map, a date stepper, river and rain charts, Authority and Public views, and a "How good is it?" tab that reads `pipeline_eval.json`.

## Rebuild

```bash
node scripts/fetch_pipeline_inputs.mjs # wards, gauges, incidents; cached in .cache/bipad
curl -o glo30.tif https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N27_00_E085_00_DEM/Copernicus_DSM_COG_10_N27_00_E085_00_DEM.tif
pip install -r scripts/requirements.txt # Python 3.12 was used
python -I scripts/prepare_terrain.py --dem glo30.tif --out data/real/kathmandu
npm run eval # writes data/real/kathmandu/pipeline_eval.json
```

## Data

- 745 verified valley incidents, June 1 to Oct 15, 2021–2026.
- 95,400 ward-days across 180 wards. 2021 contributes one usable day, because its stations report too few hours.
- Flood-family labels: 107 ward-days. Landslide labels: 89.

## Tests declared before the first run

- **Gauge detector:** official Khokana levels are the primary rules, with nothing tuned. An impact event is a day with at least 3 flood-family incidents, or a run of such days.
- **Ward model:** on held-out years, "full" must beat both "exposure" and "rain" on pooled average precision.
- **Negative control:** fire has no physical link to rain, so adding rain should not help.

## Results

### Gauge detector, six monsoons, 16 impact events

| Rule | Detected | Missed | No readings | False alarms per season |
|---|---|---|---|---|
| Khokana warning, 3.5 m | 6 | 8 | 2 | 1.17 |
| Khokana danger, 4.0 m | 5 | 9 | 2 | 0.67 |
| Valley rain ≥ 80 mm in 24 h (exploratory) | 4 | 11 | 1 | 0 |

A single outlet gauge misses most events, because many are local. A "false alarm" here means fewer than 3 reports, which does not prove nothing happened.

### September 2024

Khokana passed warning at 14:10 and danger at 14:50 on 27 Sep. Its last reading was 6.16 m around 05:30 on 28 Sep, about 15 hours later, and then the record stops. Gaurighat kept reporting, so 6.16 m is the last reading, not a confirmed peak.

The 24-hour rain index gave no lead over the river: 40 mm arrived in the same hour as the danger crossing, and higher thresholds came later.

Station totals for 26–28 Sep range from 128 to 279 mm. That is below ICIMOD's 340+ mm, which may come from other stations or a different window.

### Ward model, held-out years

| Target | Exposure | Terrain | Rain | **Full** | Full AUC | Recall in top 1% |
|---|---|---|---|---|---|---|
| Flood (same day) | 0.003 | 0.007 | 0.014 | **0.038** | 0.892 | 24% |
| Landslide (same day) | 0.004 | 0.014 | 0.010 | **0.042** | 0.863 | 25% |
| Fire control (same day) | 0.007 | 0.012 | 0.003 | 0.016 | 0.745 | 2% |
| Flood (next day) | 0.003 | 0.010 | 0.002 | 0.009 | 0.768 | 14% |
| Landslide (next day) | 0.004 | 0.014 | 0.003 | 0.020 | 0.816 | 21% |

Columns 2–5 are average precision. The flood base rate is about 0.001, so 0.038 is roughly 34 times chance.

- **Same day:** flood and landslide both pass the declared test.
- **Fire control:** passes. Rain alone is below chance (AUC 0.467), and the full model's AUC matches terrain alone (0.745 vs 0.747).
- **Next day:** flood passes the declared test but does not beat terrain alone, so there is no reliable flood lead from gauges. Landslide shows a small gain. Real lead time needs forecast rainfall.

### When vs where (diagnostic, added after the first run)

On days with incidents, how well do models rank the right wards? A day-only signal scores 0.5.

| Target | Exposure | Terrain | Rain | Full |
|---|---|---|---|---|
| Flood | 0.701 | 0.740 | 0.504 | 0.737 |
| Landslide | 0.776 | 0.778 | 0.472 | 0.763 |

Rain tells you when. Where is mostly exposure, meaning where people and roads are. Much of the headline AUC comes from picking the right day.

### Strict 2024 test

Trained on earlier years only, the model had just 8 positive examples: AUC 0.811, recall in top 1% of 5%. On 28 Sep it flagged 83 of 180 wards (46%) and caught 7 of 15 reported incidents (47%), which is no better than chance across wards. The 2024 run is weaker than the pooled table.

### Terrain against UNOSAT

With no flood imagery as input, low HAND ranks UNOSAT's flooded roads well (AUC 0.87). As a yes/no map it over-predicts: at 3 m it marks 21% of roads against the reference's 1.2%, with 79% recall and 4.7% precision. Changing the stream threshold from 5 to 300 km² did not fix this. Part of the gap may be the reference, which was imaged two days after the peak.

## Limits

- **Road closures are not predicted.** The screen cuts off about 45% of road segments, which is not credible. It is labelled a worst case in the API. BIPAD has no road, bridge or power counts, so news-based labels come first.
- **Reporting has changed.** Only 8 of 107 flood labels come from 2022–23, so some apparent change over time may be reporting, not weather.
- **Labels are reports.** Risk means the chance of a reported incident.
- **Depth is an assumption.** Danger level is treated as bank-full, and one gauge's excess as a valley-wide depth.
- **Population is a rough estimate.** Municipal census is spread over wards by road length.
- **Ward areas are approximate.** They use nearest centroid, because this feed has no polygons.
- **Terrain is a surface model.** GLO-30 includes buildings and trees. Its false dam at the valley gorge needed breaching (fill reached 52 m).
- **Licences:** BIPAD states none, so confirm before redistributing `gauges.json`, `wards_bipad.json` and `incidents_history.json`.

## Next steps

1. Build road-closure labels from dated Nepali news and bulletins.
2. Add forecast rainfall for real lead time.
3. Use all three river gauges and short-window rain, tested on held-out years.
4. Add shelter sites and stock to turn risk into resource plans.

## God's Eye View: assessment

**Recommendation: use it as an optional replay, not as the product UI or pipeline.** It has not been run or integrated here.

**Why it helps:** a 3D globe, a timeline scene director and an existing Nepal flood scene (Bhote Koshi) make it a strong way to show Sept 2024. It also has an MCP server. The code is MIT.

**Why not build on it:**

- **Stack:** it is Vue, Pinia and Cesium with about 3,000 files, while this repo is React and MapLibre.
- **Node:** it needs Node 24.14+ (below 25) or 26. This machine has 25.1.
- **Scene data limits:** at most 2,000 GeoJSON features, 50,000 positions and 8 packs per scene. The 38,038-segment road network does not fit.
- **No per-feature styling:** GeoJSON properties are ignored, so risk colours need a PNG overlay or one pack per tier.
- **Keys:** photorealistic 3D needs a Cesium ion token (personal, non-commercial) or a Google key. Voice needs OpenAI.
- **Fit:** the military HUD, ALPR cameras and "spy satellite" framing suit a humanitarian tool badly, so keep them off.
- **Licences:** bundled data is not MIT. The Bhote Koshi data is CC BY-NC 4.0.

**How to use it:** keep the pipeline as the source of truth and export a scene for 27–28 Sep: ward risk as a PNG overlay, plus up to 2,000 top exposed roads as GeoJSON. Every feature needs a string `id` and an explicit height, and the exporter is not built yet.
