import type { Entity, Feature, FeatureCollection, Kind, SceneSnapshot } from "../../../packages/ports/index.ts";

const FOCUS_COLOR: Record<string, string> = { schools: "#FFB020", closures: "#FF4A3D", pockets: "#FFB020", landslides: "#FF7A1A", hospitals: "#FF4A3D", outages: "#FFD23F" };

const of = (s: SceneSnapshot, k: Kind) => s.entities.filter((e) => e.kind === k);
const coordsFromLine = (g: Feature["geometry"]): [number, number][][] => {
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  return [];
};
const flat = (e: Entity): [number, number][] =>
  e.geom.type === "Point" ? [e.geom.coordinates] : e.geom.type === "LineString" ? e.geom.coordinates : (e.geom.coordinates as [number, number][][]).flat();
const kmD = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 98.6, (a[1] - b[1]) * 110.6);
const nearestKm = (at: [number, number], e: Entity) => Math.min(...flat(e).map((p) => kmD(at, p)));
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

export function affected(scene: SceneSnapshot, focus: string, stage: number): { fc: FeatureCollection; bounds: [[number, number], [number, number]] | null; count: number } {
  const feats: Feature[] = [], pts: [number, number][] = [];
  const color = FOCUS_COLOR[focus] ?? "#FFFFFF";
  const add = (c: [number, number][]) => { feats.push({ type: "Feature", properties: { color }, geometry: { type: "LineString", coordinates: c } }); pts.push(...c); };
  const mainRoads = scene.geo.roads.features.flatMap((f) => coordsFromLine(f.geometry));
  const closures = of(scene, "closure");
  const zoneRoads = (kind: Kind) => {
    for (const z of of(scene, kind)) {
      if (z.geom.type !== "Polygon") continue;
      const ring = grow(z.geom.coordinates[0]!, 1.4);
      pts.push(...ring);
      for (const l of mainRoads) if (l.some((p) => inPoly(p[0], p[1], ring))) add(l);
    }
  };
  switch (focus) {
    case "closures":
      closures.filter((c) => (c.stage ?? 0) <= stage).forEach((c) => coordsFromLine(c.geom).forEach(add));
      scene.geo.minor.features.forEach((f) => coordsFromLine(f.geometry).forEach(add));
      break;
    case "pockets":
      scene.geo.pockets.features.forEach((f) => coordsFromLine(f.geometry).forEach(add));
      break;
    case "landslides": zoneRoads("landslide"); break;
    case "outages": zoneRoads("outage"); break;
    case "schools":
      for (const sc of of(scene, "school").filter((x) => x.props.risk !== "ok")) {
        pts.push(sc.at);
        closures.filter((c) => (c.stage ?? 0) <= stage && nearestKm(sc.at, c) <= 1.2).forEach((c) => coordsFromLine(c.geom).forEach(add));
      }
      break;
    case "hospitals":
      for (const h of of(scene, "hospital").filter((x) => x.props.access !== "ok")) {
        pts.push(h.at);
        closures.filter((c) => (c.stage ?? 0) <= stage && kmD(c.at, h.at) <= 3.5).forEach((c) => coordsFromLine(c.geom).forEach(add));
      }
      break;
    default: break;
  }
  if (!pts.length) return { fc: { type: "FeatureCollection", features: [] }, bounds: null, count: 0 };
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { fc: { type: "FeatureCollection", features: feats }, bounds: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], count: feats.length };
}

export const distKm = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 98.6, (a[1] - b[1]) * 110.6);
