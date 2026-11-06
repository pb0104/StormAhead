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

## What would make this a real test
Use major hospitals / shelters / schools and population-weighted places as cascade targets; add an independent hazard-input quality check (e.g. Maxar 2024-10-06 imagery or Sentinel-1/2 extents); use ward polygons instead of points; pre-register a tighter radius; add power/comms data if obtainable.
