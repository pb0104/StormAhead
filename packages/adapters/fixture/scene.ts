/**
 * Kathmandu scene for the ops console (OSM + cascade on observed flood).
 * Road geometry: OpenStreetMap (Geofabrik, 2 Jan 2024, ODbL). Closures, pockets and response assets are selected for the console view.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Entity, Feature, FeatureCollection, Geometry, Kind } from "../../ports/types.ts";
export type { Entity, Geometry, Kind } from "../../ports/types.ts";

const fixture = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"));
const raw = fixture("network.json");
const floodRaw = fixture("flood.json");

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

/** Seeded noise so the scene is identical on every load. */
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

const towerSpots: [number, number, boolean][] = [
  [85.305, 27.69, true], [85.31, 27.665, true], [85.299, 27.7, false], [85.327, 27.71, false], [85.345, 27.725, false], [85.36, 27.69, false],
  [85.34, 27.668, false], [85.375, 27.705, false], [85.39, 27.68, false], [85.41, 27.676, true], [85.43, 27.7, false], [85.455, 27.69, false],
  [85.37, 27.745, false], [85.32, 27.63, false], [85.4, 27.63, false], [85.29, 27.63, false],
];
const towers: Entity[] = towerSpots.map(([lon, lat, down], i) => ({
  kind: "tower", id: `T-${String(i + 1).padStart(2, "0")}`, name: `Cell tower T-${String(i + 1).padStart(2, "0")}`, at: [lon, lat],
  props: { status: down ? "down" : "up", cause: down ? "Power loss at the site" : "" }, geom: pt(lon, lat),
}));

const outages: Entity[] = [
  ["OG-1", "Feeder F-12, Teku to Kalimati", 85.302, 27.693, 0.011, 3100],
  ["OG-2", "Feeder F-07, Balkhu south", 85.309, 27.662, 0.010, 1850],
  ["OG-3", "Feeder F-21, Thimi east", 85.41, 27.676, 0.010, 2400],
].map(([id, name, lon, lat, r, hh], i) => ({
  kind: "outage" as const, id: id as string, name: name as string, at: [lon as number, lat as number] as [number, number],
  props: { households: hh as number }, geom: blob(lon as number, lat as number, r as number, 31 + i),
}));

const dams: Entity[] = [
  ["D-1", "Upstream dam gauge A", 85.45, 27.778, 94],
  ["D-2", "Upstream dam gauge B", 85.3, 27.779, 81],
].map(([id, name, lon, lat, lvl]) => ({
  kind: "dam" as const, id: id as string, name: name as string, at: [lon as number, lat as number] as [number, number],
  props: { level: lvl as number }, geom: pt(lon as number, lat as number),
}));

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


// ---------------- schools (risk from cascade / hazard layers) ----------------
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
  if (og[0] < 0.9) { if (risk === "ok") risk = "risk"; why.push(`Grid::Inside the ${og[1].name} outage area, with no power.`); }
  return { kind: "school" as const, id: `SC-${String(i + 1).padStart(2, "0")}`, name: name, at, props: { risk, students: 240 + ((i * 137) % 520), why: why.join("|") }, geom: pt(lon, lat) };
});

// ---------------- airports, helipads, and army bases (Tribhuvan real; helipads and army on the map) ----------------
const airports: Entity[] = [
  ["AP-1", "Tribhuvan International Airport", 85.3591, 27.6966, "Main relief hub"],
].map(([id, name, lon, lat, role]) => {
  const at: [number, number] = [lon as number, lat as number];
  const cl = [...closures].map((c) => [nearestKm(at, c), c] as const).sort((a, b) => a[0] - b[0])[0]!;
  const access = cl[0] < 0.4 ? "lost" : cl[0] < 1.2 ? "degraded" : "ok";
  return { kind: "airport" as const, id: id as string, name: name as string, at, props: { access, role: role as string, closure: cl[1].id, closureM: Math.round(cl[0] * 1000) }, geom: pt(at[0], at[1]) };
});
const helipads: Entity[] = [
  ["HP-1", "Helipad H-1", 85.39, 27.725, "Casualty airlift"],
  ["HP-2", "Helipad H-2", 85.332, 27.664, "Cut-off pocket airlift"],
].map(([id, name, lon, lat, role]) => {
  const at: [number, number] = [lon as number, lat as number];
  const cl = [...closures].map((c) => [nearestKm(at, c), c] as const).sort((a, b) => a[0] - b[0])[0]!;
  const access = cl[0] < 0.4 ? "lost" : cl[0] < 1.2 ? "degraded" : "ok";
  return { kind: "helipad" as const, id: id as string, name: name as string, at, props: { access, role: role as string, closure: cl[1].id, closureM: Math.round(cl[0] * 1000) }, geom: pt(at[0], at[1]) };
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
  ...closures, ...pockets, ...landslides, ...hospitals, ...schools, ...airports, ...helipads, ...army, ...towers, ...outages, ...dams, ...shelters, ...food, ...qrt,
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
  zones: fc([...landslides, ...outages].map(feat)),
  points: fc([...hospitals, ...schools, ...airports, ...helipads, ...army, ...towers, ...dams, ...shelters, ...food, ...qrt].map(feat)),
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
