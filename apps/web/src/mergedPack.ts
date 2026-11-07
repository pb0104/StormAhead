/**
 * Kathmandu merged open-data pack (data/real/kathmandu/merged.geojson).
 * Shown on top of Maxar before/after when swipe is on.
 */
import merged from "../../../data/real/kathmandu/merged.geojson";

export type MergedKind =
  | "flood"
  | "road_impact"
  | "hospital"
  | "power_dark"
  | "landslide"
  | "maxar_footprint"
  | "ndrrma_summary";

/** Vis keys for CommandRail / MapStage. */
export const MERGED_VIS_KEYS = [
  "mergedFlood",
  "mergedRoads",
  "mergedHospitals",
  "mergedDark",
  "mergedLandslides",
  "mergedFootprints",
  "mergedNdrrma",
] as const;

export type MergedVisKey = (typeof MERGED_VIS_KEYS)[number];

export const MERGED_KIND_BY_VIS: Record<MergedVisKey, MergedKind> = {
  mergedFlood: "flood",
  mergedRoads: "road_impact",
  mergedHospitals: "hospital",
  mergedDark: "power_dark",
  mergedLandslides: "landslide",
  mergedFootprints: "maxar_footprint",
  mergedNdrrma: "ndrrma_summary",
};

export const MERGED_CHIPS: [MergedVisKey, string][] = [
  ["mergedFlood", "UNOSAT flood"],
  ["mergedRoads", "Road impacts"],
  ["mergedHospitals", "Hospitals"],
  ["mergedDark", "Night dark"],
  ["mergedLandslides", "Landslides"],
  ["mergedFootprints", "Maxar footprints"],
  ["mergedNdrrma", "NDRRMA summary"],
];

export const MERGED_ON: Record<MergedVisKey, true> = {
  mergedFlood: true,
  mergedRoads: true,
  mergedHospitals: true,
  mergedDark: true,
  mergedLandslides: true,
  mergedFootprints: true,
  mergedNdrrma: true,
};

export const MERGED_OFF: Record<MergedVisKey, false> = {
  mergedFlood: false,
  mergedRoads: false,
  mergedHospitals: false,
  mergedDark: false,
  mergedLandslides: false,
  mergedFootprints: false,
  mergedNdrrma: false,
};

export const MERGED_FC = merged as {
  type: "FeatureCollection";
  features: unknown[];
  properties?: { counts?: Record<string, number> };
};
