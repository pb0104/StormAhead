/** Shared DTOs for the ops console (web + API). */

export type Geometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "MultiLineString"; coordinates: [number, number][][] }
  | { type: "Polygon"; coordinates: [number, number][][] };

export type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: Geometry };
export type FeatureCollection = { type: "FeatureCollection"; features: Feature[] };

export type Kind =
  | "closure" | "pocket" | "landslide" | "hospital" | "tower" | "outage" | "alert"
  | "dam" | "social" | "radio" | "shelter" | "food" | "qrt" | "school" | "airport" | "helipad" | "army"
  /** REAL OSM building footprint (shelter layer). */
  | "building";

export type Entity = {
  kind: Kind; id: string; name: string; at: [number, number];
  stage?: number; props: Record<string, string | number | boolean>;
  geom: Geometry;
};

export type Reason = { input: string; text: string };
export type Action = {
  id: string; kind: "qrt" | "food" | "shelter" | "grid" | "alert" | "road" | "air" | "army";
  title: string; detail: string; targetId?: string; alertEn?: string; alertNe?: string;
};

export type SceneGeo = {
  flood: FeatureCollection;
  roads: FeatureCollection;
  closures: FeatureCollection;
  minor: FeatureCollection;
  pockets: FeatureCollection;
  zones: FeatureCollection;
  points: FeatureCollection;
  low: FeatureCollection;
  rain: FeatureCollection;
};

export type AffectedResult = {
  fc: FeatureCollection;
  bounds: [[number, number], [number, number]] | null;
  count: number;
};

export type FloodPoly = { r: number; ring: [number, number][] };

export type SceneSnapshot = {
  bbox: [number, number, number, number];
  note: string;
  entities: Entity[];
  geo: SceneGeo;
  floodPolys: FloodPoly[];
  advice: Record<string, { reasons: Reason[]; actions: Action[] }>;
  kindLabel: Record<string, string>;
};

export type Weather = {
  inches: number; mm: number; lowIn: number; highIn: number; peakMmH: number; label: string;
};

export type WeatherSeed = {
  inches: number;
  source: string;
  fetchedAt: string;
  provenance?: Record<string, unknown>;
};

export type Grid = {
  w: number; h: number; lon0: number; lon1: number; lat0: number; lat1: number; cellM: number;
  /** Serialized as number[] over the wire. */
  z: number[] | Float32Array;
};

export type TerrainResult = {
  status: "idle" | "loading" | "ready" | "fallback";
  depth0: number[];
  medianDepth: number;
  note: string;
  grid?: Grid;
};

export type FlowField = { gx: number[]; gy: number[]; acc: number[] };

export type AssessmentResult = {
  weather: Weather;
  terrain: TerrainResult;
  depths: number[];
  floodFc: FeatureCollection;
  flow: null | {
    pooledKm2: number;
    maxDepth: number;
    imagePngBase64: string;
    field: FlowField;
    grid: Grid;
  };
  flowText: string;
  wet: number;
  deepest: number;
  stageFraction: number;
};

export type TileBytes = { body: Buffer; contentType: string; cacheHit: boolean };

/** Critical map assets from OSM (hospitals, dams, schools, …). */
export type AssetKind = "hospital" | "school" | "dam" | "airport" | "helipad" | "tower" | "shelter";

export type OsmAsset = {
  id: string;
  kind: AssetKind;
  name: string;
  at: [number, number];
  geom: Geometry;
  tags: Record<string, string>;
  osmType: "node" | "way" | "relation";
  osmId: number;
};

export type AssetsSnapshot = {
  bbox: [number, number, number, number];
  fetchedAt: string;
  source: string;
  licence: string;
  cacheHit: boolean;
  counts: Partial<Record<AssetKind, number>>;
  assets: OsmAsset[];
};

/** Kathmandu atmosphere overlay (clouds + MSL pressure). */
export type AtmosphereSnapshot = {
  bbox: [number, number, number, number];
  fetchedAt: string;
  validAt: string;
  source: string;
  licence: string;
  cacheHit: boolean;
  clouds: FeatureCollection;
  isobars: FeatureCollection;
  centers: FeatureCollection;
  /** Reserved for later tornado / severe overlays. */
  extensions: Record<string, unknown>;
};
