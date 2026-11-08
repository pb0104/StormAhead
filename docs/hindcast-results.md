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

**Added later: this test could not have passed.** Random sets averaged 18.7 of 19, so they matched all 19 at least about 70% of the time. Even a perfect model would have scored p ≈ 0.7. The result shows the test was too coarse, not that the model has no skill. Road and bridge loss counts are also empty in BIPAD, and the 19 incidents sit at only 10 distinct coordinates. [pipeline.md](pipeline.md) replaces this scoring.

## Why (hypotheses, not yet tested)
1. OSM has 185 `amenity=hospital` features in the valley (many small clinics) → hospital access almost never breaks, so the "unforeseen cascade" the model can see is tiny (1 isolated place).
2. Stranded-road spurs (428) cluster at a few places; reported incidents are spread widely.
3. None of the 19 reports fall inside the SPOT-6 extent (they are 200–850 m away) → the optical extent likely under-detects urban flooding, the water had receded (18 of 19 reports are dated 27–28 Sep and the image is from 30 Sep), or report coordinates are approximate. Ground truth and hazard input are both imperfect.
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

## Ward-level scorecard, per agent (run 2026-11-07)

The 1 km radius test could not discriminate: in a valley this dense, almost any set of the right size covers the
incidents, so every baseline tied. Two changes fix the method rather than the model:

1. **Score on wards, not radii.** BIPAD records are ward-level reports, so the ward is the resolution the ground
 truth actually exists at; a 1 km circle around a ward-level point was false precision. 203 ward polygons
 (OSM `admin_level=9`, pinned to the 2024-09-26 attic date, **evaluation geometry only — never a model input**).
2. **Count false alarms.** A ward is flagged or not, and reported damage or not, so flagging half the valley is
 now visibly expensive. The old test had no way to express that cost.

19 scorable incidents fall in **10 of 203 wards**. Each agent is compared with same-size random and
nearest-the-flood baselines, so breadth is not rewarded.

| Agent | Wards flagged | Hit | False alarm | Precision | Recall | F1 | Random F1 | p |
|---|---|---|---|---|---|---|---|---|
| *Hazard (GIVEN — not a prediction)* | 67 | 6 | 61 | 0.09 | 0.60 | 0.16 | 0.09 | 0.067 |
| Infrastructure Agent | 59 | 6 | 53 | 0.10 | 0.60 | **0.17** | 0.08 | **0.030** |
| Access Agent | 102 | 6 | 96 | 0.06 | 0.60 | 0.11 | 0.09 | 0.392 |
| Shelter Agent | 10 | 2 | 8 | **0.20** | 0.20 | **0.20** | 0.05 | 0.082 |
| All agents combined | 125 | 9 | 116 | 0.07 | 0.90 | 0.13 | 0.09 | 0.056 |

The hazard row is the bar: it is the observed flood extent, a model *input*. Any agent that does not beat it has
added nothing to simply knowing where the water was.

**Readings, in order of confidence:**

- **The Access Agent is the weak one.** It flags 102 of 203 wards — half the valley — to find the same 6 wards the
 Infrastructure Agent finds with 59. p = 0.39 is indistinguishable from drawing wards at random. This is exactly
 the failure the old metric hid: its recall looked identical, and only the false-alarm count separates them.
- **The Shelter Agent raises the fewest and best concerns.** 10 wards flagged, the highest precision (0.20) and the
 best F1, though on only 2 hits — far too few to call it skill (p = 0.082).
- **The Infrastructure Agent is the only one under p < 0.05, and it does not survive scrutiny** (see below). Its F1
 of 0.17 barely exceeds the given hazard's 0.16, so even at face value it adds almost nothing to the flood map.
- **Combined, the agents reach 0.90 recall by flagging 62% of the valley.** Operationally that is not a warning.

### The same result as a map

`GET /api/verification` returns the ward polygons carrying their outcome, with the withheld reports as points;
the console draws it under **Verification (real)**. Of 203 wards: **9 hit, 1 missed (Lalitpur-12), 116 false
alarms, 77 correctly left alone.** The picture is the finding — a thin scatter of correct calls inside a wash of
false alarms. Note that the given hazard is excluded from the map's "flagged" set, since it is an input.

There is deliberately **no predicted-vs-actual flood map**: the flood extent is given to the engine, not
predicted by it, so such a map would credit the model with the hazard it was handed.

## Does the stale road network explain any of it? No (run 2026-11-07)

The committed network is the Geofabrik snapshot of **2 Jan 2024**, nine months before the event, so roads built
during 2024 are missing — a documented weakness. Overpass attic queries make a **26 Sep 2024** network possible,
one day before the event. Both were run against the same hazard and the same ground truth.

| | 2 Jan 2024 (committed) | 26 Sep 2024 (1 day pre-event) |
|---|---|---|
| Edges / nodes | 38,038 / 31,045 | 40,934 / 33,561 |
| Roads touching flood / closed | 462 / 310 | 470 / 329 |
| Dry places with no hospital access / degraded | **1 / 0** | **1 / 0** |
| Dry roads stranded | 428 | 329 |
| OSM hospitals | 185 | 252 |
| Point test (1 km) | 16/19, p ≈ 1.0 | 15/19, p ≈ 0.99 |
| Infrastructure Agent, ward F1 / p | 0.17 / **0.030** | 0.17 / **0.052** |
| Access Agent, ward F1 / p | 0.11 / 0.392 | 0.10 / 0.504 |

**The stale network was not the problem.** The cascade is identical where it matters (1 isolated place, 0
degraded), and the headline does not move. Stranded roads fall from 428 to 329, which is the expected direction:
more roads means better connectivity, so fewer dead ends.

**And the one significant result does not replicate.** The Infrastructure Agent's p = 0.030 becomes p = 0.052 on a
*better* input. A finding that flips across a routine change of snapshot is noise, not skill. Treat the whole row
as negative.

The hospital count rising from 185 to 252 reinforces the leading hypothesis: OSM keeps adding clinics, hospital
access almost never breaks, and so the cascade the model can see stays vanishingly small.

## What would make this a real test
**Restrict the hospital set** to facilities that can actually receive patients (now 252 OSM features, many small clinics) — the leading hypothesis, untouched by changing either the targets or the network snapshot (the 185 OSM features include small clinics) — this is now the leading hypothesis, since changing the targets did not help; use population-weighted places; add an independent hazard-input quality check (e.g. Maxar 2024-10-06 imagery or Sentinel-1/2 extents); use ward polygons instead of points; pre-register a tighter radius; add power/comms data if obtainable.
