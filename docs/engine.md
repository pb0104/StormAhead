# The engine

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

## Before / after imagery

**Before / after imagery** in the command rail swipes between two Maxar Open Data mosaics, 13 Jan 2024 and 6 Oct 2024, built by `scripts/build_maxar_mosaics.py`. The observed UNOSAT footprint is drawn in cyan over both sides.

**How Maxar is ground truth.** Live agents never see the after mosaic or the BIPAD impact file — those are held for grading. The evaluation pack treats Maxar as the optical change record for the valley: where the 6 Oct scene is clear, before/after tiles show what actually changed on the ground after the September flood; the council and the geographic checks use that change, with UNOSAT (wet extent on 30 Sep) and withheld BIPAD ward reports, to score whether flags landed in the right places. Cloudy tiles are simply out of the visual check; they do not invent flood polygons. Maxar Open Data is **CC BY-NC 4.0**.

## Evaluation results

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

See also: [pipeline.md](pipeline.md), [hindcast-results.md](hindcast-results.md), [data-provenance.md](data-provenance.md).
