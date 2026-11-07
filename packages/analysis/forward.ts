/**
 * Forward hazard: replaces the observed flood map with one derived from pre-event terrain and a live river reading.
 * The output feeds the existing cascade engine unchanged, so closures and access use the same rules in both modes.
 * Results are "at risk" estimates. HAND gives no timing or depth, and nothing here confirms that a road actually closed.
 */
import type { RealArea, RealEdge, RealPoint } from "./cascade.ts";

export type PointTerrain = { hand: number; elev: number; slopeNear: number };
export type Terrain = {
  streamKm2: number; handThresholdsM: number[];
  edges: { handMin: number[]; shareBelow: number[][]; slopeNear: number[]; ward: number[] };
  places: PointTerrain[]; hospitals: PointTerrain[];
  wards: { id: number; elev: number; slopeMean: number; slopeP90: number; lowHandShare: number; roadKm: number }[];
};

/**
 * Water above the official danger level, rounded up to a stored HAND threshold. Null below danger: no river flood is predicted.
 * Assumption, not a calibrated rating curve: danger level is treated as bank-full, and the excess at one gauge as a valley-wide depth.
 */
export function stageToHandM(stage: number, dangerLevel: number, thresholds: number[]): number | null {
  const excess = stage - dangerLevel;
  if (excess < 0) return null;
  return thresholds.find((t) => t >= excess) ?? thresholds[thresholds.length - 1]!;
}

/** A copy of the area whose flood fields come from terrain at `handM`, not from any flood imagery. */
export function predictedArea(area: RealArea, t: Terrain, handM: number): RealArea {
  const k = t.handThresholdsM.indexOf(handM);
  if (k < 0) throw new Error(`No stored HAND threshold ${handM}`);
  const edges: RealEdge[] = area.edges.map((e, i) => ({ ...e, floodedShare: t.edges.shareBelow[i]![k]! }));
  const flag = (pts: RealPoint[], ts: PointTerrain[]) => pts.map((p, i) => ({ ...p, inFlood: ts[i]!.hand <= handM }));
  return { ...area, edges, places: flag(area.places, t.places), hospitals: flag(area.hospitals, t.hospitals) };
}

export type ExposureMatch = { predicted: number; observed: number; overlap: number; recall: number; precision: number; lift: number };

/** Compares predicted road exposure with a reference map. The reference is imperfect too, so this is agreement, not accuracy. */
export function compareExposure(predicted: boolean[], observed: boolean[]): ExposureMatch {
  let p = 0, o = 0, both = 0;
  predicted.forEach((x, i) => { if (x) p++; if (observed[i]) o++; if (x && observed[i]) both++; });
  const precision = p ? both / p : 0;
  return { predicted: p, observed: o, overlap: both, recall: o ? both / o : 0, precision, lift: o ? precision / (o / predicted.length) : 0 };
}

/** Roads beside steep ground, the terrain half of landslide exposure. Rain decides when they matter; the ward model covers that. */
export function steepRoads(t: Terrain, minSlopeDeg: number): number[] {
  return t.edges.slopeNear.flatMap((s, i) => (s >= minSlopeDeg ? [i] : []));
}

const NOT_MAJOR = /clinic|poly|dental|dent\b|eye|opthal|ophthal|ayurved|homeo|nursing|health ?post|veterinary|vet\b|pharmacy|lab\b|diagnostic|unnamed/i;
/** Rough name filter for facilities likely to take emergencies. OSM has no bed counts here, so check the list before relying on it. */
export const isMajorHospital = (name: string) => !NOT_MAJOR.test(name);

export type AlertLevel = "none" | "authority" | "public-draft";
/**
 * One risk score, two audiences. Authorities see earlier, less certain risk. A public alert needs a higher score and a river
 * above danger, and it is only ever a draft: a person must approve it, and this project sends nothing.
 */
export function alertLevel(score: number, authorityCut: number, publicCut: number, riverAboveDanger: boolean): AlertLevel {
  if (score >= publicCut && riverAboveDanger) return "public-draft";
  return score >= authorityCut ? "authority" : "none";
}
