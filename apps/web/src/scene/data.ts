/**
 * Scene layer for the ops console.
 * Road geometry: OpenStreetMap (Geofabrik, 2 Jan 2024, ODbL). Cell sites: OpenCelliD with modelled status.
 * Outage areas: NASA night-lights (realdata.ts). Closures, pockets and response assets are selected for the console view.
 */
import raw from "./network.json";
import floodRaw from "./flood.json";
import { CELL_SITES, cellStatus, DARK_AREAS } from "../realdata.ts";

export type Geometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "MultiLineString"; coordinates: [number, number][][] }
  | { type: "Polygon"; coordinates: [number, number][][] };
type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: Geometry };
type FeatureCollection = { type: "FeatureCollection"; features: Feature[] };

export type Kind =
  | "closure" | "pocket" | "landslide" | "hospital" | "tower" | "outage" | "alert"
  | "dam" | "social" | "radio" | "shelter" | "food" | "qrt" | "school" | "airport" | "army"
  /** REAL OSM building footprint (OSM building footprints). */
  | "building";

export type Entity = {
  kind: Kind; id: string; name: string; at: [number, number];
  stage?: number; props: Record<string, string | number | boolean>;
  geom: Geometry;
};

type Net = {
  meta: { note: string; bbox: number[] };
  roads: [number, number[]][];
  closures: { id: string; name: string; cls: string; bridge: boolean; stage: number; order: number; lengthM: number; mid: [number, number]; lines: number[][] }[];
  minor: number[][];
  pockets: { id: string; name: string; mid: [number, number]; edges: number; lines: number[][] }[];
  strandedRest: number[][];
};
const net = raw as unknown as Net;

export const BBOX = net.meta.bbox as [number, number, number, number];
export const DATA_NOTE = net.meta.note;

const coords = (flat: number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
};
const multi = (lines: number[][]): Extract<Geometry, { type: "MultiLineString" }> => ({ type: "MultiLineString", coordinates: lines.map(coords) });

/** Seeded noise so the fixtures are identical on every load. */
function rng(seed: number) { let a = seed; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function blob(lon: number, lat: number, r: number, seed: number, n = 16): Extract<Geometry, { type: "Polygon" }> {
  const rnd = rng(seed), k = Math.cos((lat * Math.PI) / 180);
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, rr = r * (0.7 + rnd() * 0.5); ring.push([lon + (Math.cos(a) * rr) / k, lat + Math.sin(a) * rr]); }
  ring.push(ring[0]!);
  return { type: "Polygon", coordinates: [ring] };
}
const pt = (lon: number, lat: number): Extract<Geometry, { type: "Point" }> => ({ type: "Point", coordinates: [lon, lat] });

// ---------------- scene entities ----------------
const closures: Entity[] = net.closures.map((c) => ({
  kind: "closure", id: c.id, name: c.name, at: c.mid, stage: c.stage,
  props: { cls: c.cls, bridge: c.bridge, lengthM: c.lengthM, order: c.order }, geom: multi(c.lines),
}));
const pockets: Entity[] = net.pockets.map((p) => ({
  kind: "pocket", id: p.id, name: p.name, at: p.mid, props: { segments: p.edges }, geom: multi(p.lines),
}));

const landslides: Entity[] = [
  ["LS-1", "Shivapuri south slope", 85.385, 27.775, 0.011],
  ["LS-2", "Nakkhu slope, Lalitpur", 85.319, 27.653, 0.008],
  ["LS-3", "Chandragiri east ridge", 85.295, 27.668, 0.009],
  ["LS-4", "Nagarkot west slope", 85.475, 27.735, 0.010],
].map(([id, name, lon, lat, r], i) => ({
  kind: "landslide" as const, id: id as string, name: name as string, at: [lon as number, lat as number] as [number, number],
  props: { risk: ["High", "High", "Medium", "Medium"][i]!, households: [140, 220, 90, 120][i]! }, geom: blob(lon as number, lat as number, r as number, 11 + i),
}));

const hospitals: Entity[] = [
  ["HS-1", "TU Teaching Hospital", 85.330002, 27.736013, "ok", 0],
  ["HS-2", "Bir Hospital", 85.313398, 27.70516, "degraded", 18],
  ["HS-3", "Patan Hospital", 85.320426, 27.668467, "lost", 0],
  ["HS-4", "Civil Service Hospital", 85.339077, 27.686557, "ok", 0],
  ["HS-5", "Norvic Hospital", 85.319219, 27.689971, "degraded", 12],
  ["HS-6", "Bhaktapur Hospital", 85.422086, 27.672077, "lost", 0],
].map(([id, name, lon, lat, access, extra]) => ({
  kind: "hospital" as const, id: id as string, name: name as string, at: [lon as number, lat as number] as [number, number],
  props: { access: access as string, extraMin: extra as number }, geom: pt(lon as number, lat as number),
}));

// REAL cell-site positions (OpenCelliD); status MODELLED from the real observed flood extent. See realdata.ts.
const towers: Entity[] = CELL_SITES.map((s) => ({
  kind: "tower", id: s.id, name: `Cell site ${s.id} · ${s.operators.join(", ")}`, at: [s.lon, s.lat],
  props: {
    status: cellStatus(s), cells: s.cells, radios: s.radios.join(", "), operators: s.operators.join(", "), samples: s.samples,
    firstSeen: s.firstSeen, preEvent: s.preEvent, distFloodM: s.distFloodM,
  },
  geom: pt(s.lon, s.lat),
}));

// REAL power-outage areas: clusters of night-lights cells that went dark after the flood (NASA Black Marble). See realdata.ts.
const outages: Entity[] = DARK_AREAS.map((a) => ({
  kind: "outage" as const, id: a.id, name: a.name, at: [a.lon, a.lat] as [number, number],
  props: { cells: a.cells, areaKm2: a.areaKm2, medianRatio: a.medianRatio }, geom: { type: "Polygon" as const, coordinates: [a.ring] },
}));

const alerts: Entity[] = [
  ["AL-1", "Southern river corridor", 85.303, 27.668, 0.021],
  ["AL-2", "Central valley, east bank", 85.362, 27.692, 0.017],
].map(([id, name, lon, lat, r], i) => ({
  kind: "alert" as const, id: id as string, name: name as string, at: [lon as number, lat as number] as [number, number],
  props: { audience: [38000, 24000][i]! }, geom: blob(lon as number, lat as number, r as number, 51 + i, 20),
}));

const dams: Entity[] = [
  ["D-1", "Upstream dam gauge A", 85.45, 27.778, 94],
  ["D-2", "Upstream dam gauge B", 85.3, 27.779, 81],
].map(([id, name, lon, lat, lvl]) => ({
  kind: "dam" as const, id: id as string, name: name as string, at: [lon as number, lat as number] as [number, number],
  props: { level: lvl as number }, geom: pt(lon as number, lat as number),
}));

const near = (e: Entity, dLon: number, dLat: number): [number, number] => [e.at[0] + dLon, e.at[1] + dLat];
const socialTexts = ["Photo: water over the road at the underpass", "Video: shops flooded, people moving up the lane", "Post: bridge approach under water", "Photo: vehicles stuck at the crossing", "Post: no mobile signal since 9 pm", "Video: river over the embankment"];
const radioTexts = ["Call-in: road to the hospital is cut at the bridge", "Call-in: families on the roof, need boats", "Call-in: river is still rising near the market", "Call-in: power is out in our ward", "Call-in: hillside cracked above the school"];
const social: Entity[] = closures.slice(0, 8).map((c, i) => {
  const at = near(c, (i % 2 ? 1 : -1) * 0.0022, (i % 3 ? 1 : -1) * 0.0018);
  return { kind: "social" as const, id: `SM-${i + 1}`, name: "Social media post", at, props: { text: socialTexts[i % socialTexts.length]!, when: `${20 + (i % 3)}:${10 + i * 4}` }, geom: pt(at[0], at[1]) };
});
const radio: Entity[] = [...closures.slice(1, 5), landslides[1]!, outages[0]!].map((c, i) => {
  const at = near(c, (i % 2 ? -1 : 1) * 0.0026, (i % 2 ? 1 : -1) * 0.0021);
  return { kind: "radio" as const, id: `RD-${i + 1}`, name: "Radio call-in", at, props: { text: radioTexts[i % radioTexts.length]!, when: `${21 + (i % 2)}:${5 + i * 7}` }, geom: pt(at[0], at[1]) };
});

const shelters: Entity[] = [
  ["SH-1", "Ward school shelter", 85.347, 27.72, 400, 120], ["SH-2", "Community hall shelter", 85.318, 27.716, 250, 60],
  ["SH-3", "Sports ground shelter", 85.39, 27.7, 600, 90], ["SH-4", "Hilltop school shelter", 85.372, 27.738, 300, 0], ["SH-5", "Eastern ward shelter", 85.428, 27.69, 350, 140],
].map(([id, name, lon, lat, cap, occ]) => ({
  kind: "shelter" as const, id: id as string, name: name as string, at: [lon as number, lat as number] as [number, number],
  props: { capacity: cap as number, occupied: occ as number }, geom: pt(lon as number, lat as number),
}));
const food: Entity[] = [
  ["FD-1", "Food depot, central", 85.358, 27.703, 4200], ["FD-2", "Food depot, west", 85.308, 27.722, 2600], ["FD-3", "Food depot, east", 85.405, 27.692, 3100],
].map(([id, name, lon, lat, packs]) => ({
  kind: "food" as const, id: id as string, name: name as string, at: [lon as number, lat as number] as [number, number],
  props: { packs: packs as number }, geom: pt(lon as number, lat as number),
}));
const qrt: Entity[] = [
  ["QRT-1", "QRT-1 staging", 85.33, 27.7], ["QRT-2", "QRT-2 staging", 85.38, 27.712], ["QRT-3", "QRT-3 staging", 85.352, 27.676], ["QRT-4", "QRT-4 staging", 85.418, 27.694],
].map(([id, name, lon, lat]) => ({
  kind: "qrt" as const, id: id as string, name: name as string, at: [lon as number, lat as number] as [number, number],
  props: { members: 12 }, geom: pt(lon as number, lat as number),
}));


// ---------------- schools (risk computed from cascade / hazard layers) ----------------
const flat = (g: Geometry): [number, number][] =>
  g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : (g.coordinates as [number, number][][]).flat();
const kmD = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 98.6, (a[1] - b[1]) * 110.6);
const nearestKm = (at: [number, number], e: Entity) => Math.min(...flat(e.geom).map((p) => kmD(at, p)));
const schoolSpots: [string, number, number][] = [
  ["Nakkhu Valley School", 85.318, 27.66], ["Chandragiri View School", 85.297, 27.672], ["Shivapuri Lower School", 85.388, 27.768],
  ["Nagarkot West School", 85.472, 27.728], ["Teku Riverside School", 85.304, 27.69], ["Thimi East School", 85.41, 27.678],
  ["Central Girls School", 85.33, 27.7], ["Pashupati Basic School", 85.352, 27.71], ["Gaushala School", 85.375, 27.715],
  ["Baneshwor School", 85.345, 27.675], ["Tilganga School", 85.39, 27.695], ["Bhaktapur Model School", 85.43, 27.69],
  ["Kalimati School", 85.31, 27.72], ["Budhanilkantha School", 85.36, 27.74],
];
const viaClosure = (c: Entity, name: string): [string, number, number] => { const p = flat(c.geom)[Math.floor(flat(c.geom).length / 2)]!; return [name, p[0] + 0.0014, p[1] + 0.001]; };
schoolSpots.push(viaClosure(closures[1]!, "Riverbank Basic School"), viaClosure(closures[3]!, "Bridge Road School"));
const schools: Entity[] = schoolSpots.map(([name, lon, lat], i) => {
  const at: [number, number] = [lon, lat], why: string[] = [];
  const ls = [...landslides].map((l) => [nearestKm(at, l), l] as const).sort((a, b) => a[0] - b[0])[0]!;
  const cl = [...closures].map((c) => [nearestKm(at, c), c] as const).sort((a, b) => a[0] - b[0])[0]!;
  const og = [...outages].map((o) => [nearestKm(at, o), o] as const).sort((a, b) => a[0] - b[0])[0]!;
  let risk: "ok" | "risk" | "high" = "ok";
  if (ls[0] < 1.2) { risk = "high"; why.push(`Terrain::Below the ${ls[1].name}, ${ls[0].toFixed(1)} km away. Slope risk ${ls[1].props.risk}.`); }
  if (cl[0] < 0.6) { if (cl[0] < 0.35) risk = "high"; else if (risk === "ok") risk = "risk"; why.push(`Road network::Closed road ${cl[1].id} is ${Math.round(cl[0] * 1000)} m away, so buses and parents may not reach it.`); }
  if (og[0] < 0.9) { if (risk === "ok") risk = "risk"; why.push(`Grid::Near ${og[1].name}, where lights went out after the flood (NASA night lights).`); }
  return { kind: "school" as const, id: `SC-${String(i + 1).padStart(2, "0")}`, name: name, at, props: { risk, students: 240 + ((i * 137) % 520), why: why.join("|") }, geom: pt(lon, lat) };
});

// ---------------- airports and army bases (Tribhuvan at real position; others planning sites) ----------------
const airports: Entity[] = [
  ["AP-1", "Tribhuvan International Airport", 85.3591, 27.6966, "Main relief hub"],
  ["AP-2", "Helipad H-1", 85.39, 27.725, "Casualty airlift"],
  ["AP-3", "Helipad H-2", 85.332, 27.664, "Cut-off pocket airlift"],
].map(([id, name, lon, lat, role]) => {
  const at: [number, number] = [lon as number, lat as number];
  const cl = [...closures].map((c) => [nearestKm(at, c), c] as const).sort((a, b) => a[0] - b[0])[0]!;
  const access = cl[0] < 0.4 ? "lost" : cl[0] < 1.2 ? "degraded" : "ok";
  return { kind: "airport" as const, id: id as string, name: name as string, at, props: { access, role: role as string, closure: cl[1].id, closureM: Math.round(cl[0] * 1000) }, geom: pt(at[0], at[1]) };
});
const army: Entity[] = [
  ["AB-1", "Army base A, engineers", 85.405, 27.708, "Engineers: bridging and debris clearance"],
  ["AB-2", "Army base B, medical and transport", 85.31, 27.738, "Field medics and heavy trucks"],
  ["AB-3", "Army base C, rescue boats", 85.44, 27.682, "Rescue boats and swimmers"],
].map(([id, name, lon, lat, role]) => {
  const at: [number, number] = [lon as number, lat as number];
  const cl = [...closures].map((c) => [nearestKm(at, c), c] as const).sort((a, b) => a[0] - b[0])[0]!;
  const access = cl[0] < 0.4 ? "lost" : cl[0] < 1.2 ? "degraded" : "ok";
  return { kind: "army" as const, id: id as string, name: name as string, at, props: { access, role: role as string, closure: cl[1].id, closureM: Math.round(cl[0] * 1000) }, geom: pt(at[0], at[1]) };
});

export const ENTITIES: Entity[] = [
  ...closures, ...pockets, ...landslides, ...hospitals, ...schools, ...airports, ...army, ...towers, ...outages, ...alerts, ...dams, ...social, ...radio, ...shelters, ...food, ...qrt,
];
export const BY_ID = new Map(ENTITIES.map((e) => [e.id, e]));
export const OF = (k: Kind) => ENTITIES.filter((e) => e.kind === k);

// ---------------- GeoJSON for the map ----------------
const feat = (e: Entity): Feature => ({
  type: "Feature", geometry: e.geom,
  properties: { id: e.id, kind: e.kind, name: e.name, stage: e.stage ?? 0, order: (e.props.order as number) ?? 0, access: (e.props.access as string) ?? "", risk: (e.props.risk as string) ?? "", status: (e.props.status as string) ?? "" },
});
const fc = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const line = (flat: number[], p: Record<string, string | number>): Feature => ({ type: "Feature", properties: p, geometry: { type: "LineString", coordinates: coords(flat) } });

/** Observed flood extent (UNOSAT SPOT-6, 30 Sep 2024), polygons largest first. `r` is the share rank used to reveal more water as time advances . */
export const FLOOD_POLYS = floodRaw as unknown as { r: number; ring: [number, number][] }[];

export const GEO = {
  flood: fc(FLOOD_POLYS.map((p) => ({ type: "Feature" as const, properties: { r: p.r }, geometry: { type: "Polygon" as const, coordinates: [p.ring] } }))),
  roads: fc(net.roads.map(([c, flat]) => line(flat, { c }))),
  closures: fc(closures.map(feat)),
  minor: fc(net.minor.map((l) => line(l, { stage: 1 }))),
  pockets: fc([...pockets.map(feat), ...net.strandedRest.map((l) => line(l, { id: "", kind: "pocket-minor" }))]),
  zones: fc([...landslides, ...outages, ...alerts].map(feat)),
  points: fc([...hospitals, ...schools, ...airports, ...army, ...towers, ...dams, ...social, ...radio, ...shelters, ...food, ...qrt].map(feat)),
  low: fc(closures.slice(0, 10).map((c, i) => ({ type: "Feature" as const, properties: {}, geometry: blob(c.at[0], c.at[1], 0.0055 + (i % 3) * 0.0012, 71 + i) }))),
  rain: fc([
    { type: "Feature" as const, properties: { v: 3 }, geometry: blob(85.385, 27.765, 0.045, 91, 24) },
    { type: "Feature" as const, properties: { v: 2 }, geometry: blob(85.3, 27.635, 0.04, 92, 24) },
  ]),
};

// ---------------- "affected roads" for the status-strip filters ----------------
const FOCUS_COLOR: Record<string, string> = { schools: "#FFB020", closures: "#FF4A3D", pockets: "#FFB020", landslides: "#FF7A1A", hospitals: "#FF4A3D", outages: "#FFD23F" };
let roadLines: [number, number][][] | null = null;
const mainRoads = () => (roadLines ??= net.roads.map(([, f]) => coords(f)));
const inPoly = (x: number, y: number, ring: [number, number][]) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const grow = (ring: [number, number][], k: number): [number, number][] => {
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  return ring.map((p) => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k]);
};
const kmBetween = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 98.6, (a[1] - b[1]) * 110.6);

/** Roads touched by a status-strip category, plus the bounds to zoom to. */
export function affected(focus: string, stage: number): { fc: FeatureCollection; bounds: [[number, number], [number, number]] | null; count: number } {
  const feats: Feature[] = [], pts: [number, number][] = [];
  const color = FOCUS_COLOR[focus] ?? "#FFFFFF";
  const add = (c: [number, number][]) => { feats.push({ type: "Feature", properties: { color }, geometry: { type: "LineString", coordinates: c } }); pts.push(...c); };
  const zoneRoads = (kind: Kind) => {
    for (const z of OF(kind)) {
      const ring = grow((z.geom as Extract<Geometry, { type: "Polygon" }>).coordinates[0]!, 1.4);
      pts.push(...ring);
      for (const l of mainRoads()) if (l.some((p) => inPoly(p[0], p[1], ring))) add(l);
    }
  };
  switch (focus) {
    case "closures": closures.filter((c) => (c.stage ?? 0) <= stage).forEach((c) => (c.geom as Extract<Geometry, { type: "MultiLineString" }>).coordinates.forEach(add)); net.minor.forEach((f) => add(coords(f))); break;
    case "pockets": pockets.forEach((p) => (p.geom as Extract<Geometry, { type: "MultiLineString" }>).coordinates.forEach(add)); net.strandedRest.forEach((f) => add(coords(f))); break;
    case "landslides": zoneRoads("landslide"); break;
    case "outages": zoneRoads("outage"); break;
    case "schools":
      for (const sc of schools.filter((x) => x.props.risk !== "ok")) {
        pts.push(sc.at);
        closures.filter((c) => (c.stage ?? 0) <= stage && nearestKm(sc.at, c) <= 1.2).forEach((c) => (c.geom as Extract<Geometry, { type: "MultiLineString" }>).coordinates.forEach(add));
      }
      break;
    case "hospitals":
      for (const h of hospitals.filter((x) => x.props.access !== "ok")) {
        pts.push(h.at);
        closures.filter((c) => (c.stage ?? 0) <= stage && kmBetween(c.at, h.at) <= 3.5).forEach((c) => (c.geom as Extract<Geometry, { type: "MultiLineString" }>).coordinates.forEach(add));
      }
      break;
    default: break;
  }
  if (!pts.length) return { fc: { type: "FeatureCollection", features: [] }, bounds: null, count: 0 };
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { fc: { type: "FeatureCollection", features: feats }, bounds: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], count: feats.length };
}
