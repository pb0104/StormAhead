# Kathmandu hindcast — what we measured (run 2026-11-06)

**Question:** given the flood (UNOSAT observed extent, 30 Sep 2024 — a *given input*, not predicted), can agents predict knock-on impacts that the flood map alone does not show, using only a pre-event road network (OSM 2024-01-02)? Scored afterwards against independent BIPAD incident reports.

## Pre-declared design (fixed before looking at results)
- Primary test set: verified BIPAD incidents in the UNOSAT analysis extent, 2024-09-26…10-06, hazard ∈ {Flood, Inundation, Heavy Rainfall}, with reported impact → **19 incidents**.
- Success = beats BOTH baselines: (a) same-size random dry items (permutation, 2000, p<0.05) and (b) same-size dry items nearest the flood extent.
- Landslides scored separately as a known out-of-model check; Fire excluded.
- Match radius 1000 m, in-flood buffer 100 m, closure rule: bridge touching flood or ≥30% of length flooded.

## Result (default parameters)
| | |
|---|---|
| Road segments touching flood / closed (bridges) | 462 / 310 (54) of 38,038 |
| Places directly flooded | 9 of 718 |
| **Cascade:** dry places with no hospital access / degraded | **1 / 0** |
| **Cascade:** dry roads stranded from the network | **428** |
| Incidents outside flood extent (of 19) | **19 (none inside the extent)** |
| Within 1000 m of a predicted cascade item | 16 / 19 (84%) |
| Random same-size dry items (mean) | **18.7** (p ≈ 1.0) |
| Nearest-the-flood baseline | 16 |

**Verdict: no demonstrated predictive skill.** The 84% headline is not evidence — a random set of the same size does as well, and the proximity baseline ties it. The 1 km radius is too coarse in a dense valley to discriminate.

Exploratory (added *after* seeing the above, so not a primary result): at tighter radii the model does **worse** than random — 250 m: 0/19 vs random 8.5; 500 m: 7/19 vs 15.9.
Closure threshold (10/30/50%) does not change the conclusion. Landslide check: 15/17 outside-flood near flagged items vs random 14.6 (p≈0.55) — also no skill.

## Why (hypotheses, not yet tested)
1. OSM has 185 `amenity=hospital` features in the valley (many small clinics) → hospital access almost never breaks, so the "unforeseen cascade" the model can see is tiny (1 isolated place).
2. Stranded-road spurs (428) cluster at a few places; reported incidents are spread widely.
3. None of the 19 reports fall inside the SPOT-6 extent (they are 200–850 m away) → the optical extent likely under-detects urban flooding, or report coordinates are approximate. Ground truth and hazard input are both imperfect.
4. 19 incidents is a small sample.

## Buildings as cascade targets (run 2026-11-07)

Hypothesis 2 above said the target set was the problem: 428 stranded-road spurs cluster at a few places, while the
reports are spread out. Test: add **7,115 pre-event OSM building footprints** (shelter-relevant types only, Overpass
attic query pinned to the same 2024-01-02 snapshot) as cascade targets and re-score. This was chosen *after* the
primary null result, so it is **exploratory, not a pre-registered test**.

Both baselines draw the same number of items *per class* from the same dry pools, so adding a class cannot flatter
the model by itself.

| Target set | Covered / 19 | Random mean | p | Proximity |
|---|---|---|---|---|
| Primary (1 place + 428 stranded roads) | 16 | 18.7 | ≈1.0 | 16 |
| **+ 12 cut-off buildings** | 19 | 18.7 | 0.72 | 16 |
| **12 cut-off buildings only** | 4 | 2.9 | 0.36 | 4 |

**Verdict: still no demonstrated predictive skill.** Adding buildings covers all 19 incidents, but that is
saturation, not skill: random sets of the same size cover 18.7 of 19, so at a 1 km radius in this valley almost any
439-item set wins. The buildings-only set is the interesting one — 12 targets instead of 439, covering 4 of 19
against a random 2.9 — but p = 0.36 is nowhere near significant, and the proximity baseline again ties exactly.
A sparser target set is the right direction, but 19 incidents cannot resolve it.

The cascade itself stayed small for the same reason as before: of 7,115 buildings, 11 stand in the flood extent and
only 12 dry ones lose all hospital access. Hypothesis 1 (185 OSM "hospitals", so access rarely breaks) survives this
test and is now the leading explanation — changing the *targets* did not help, so the next thing to change is the
*hospital set*.

### Shelter reading (an output, not a prediction — unscored)
The same building layer answers an operational question the hindcast never asked, so nothing below is evidence of
skill; it is reported for completeness.

| | |
|---|---|
| Buildings in the flood extent with floors above the water (shelter in place) | 4 |
| Buildings in the flood extent with no floor above the water (evacuate) | 6 |
| Dry upper-floor buildings inside cut-off areas (local refuge) | 3, about 1,504 places |
| No usable `building:levels`, so **no judgement offered** | 1,391 of 7,115 (20%) |

Capacity assumes 3.5 m²/person (Sphere) over 70% of footprint area, and that a flooded building loses exactly one
floor — the engine's hazard is binary (in/out of the observed extent), so it cannot tell 0.3 m from 3 m. These are
documented assumptions, not measurements, and the one-floor rule is the optimistic case.

## What would make this a real test
Restrict the hospital set to facilities that can actually receive patients (the 185 OSM features include small clinics) — this is now the leading hypothesis, since changing the targets did not help; use population-weighted places; add an independent hazard-input quality check (e.g. Maxar 2024-10-06 imagery or Sentinel-1/2 extents); use ward polygons instead of points; pre-register a tighter radius; add power/comms data if obtainable.
