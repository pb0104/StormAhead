/**
 * How many people may still need help near a place: an ORDER-OF-MAGNITUDE ESTIMATE, labelled as such everywhere.
 *
 *   people ≈ Σ over flooded 50 m cells within the radius of (municipality density × cell area)
 *
 * Flooded cells come from the UNOSAT observed extent (30 Sep 2024). Density is the 2021 census population of the cell's
 * municipality (BIPAD) over the area of that municipality's wards inside the analysis extent. Municipalities with only a few
 * wards inside the extent would get an inflated density that way, so they use the median of the others. River channels count
 * as flooded ground, so treat the result as an upper bound. Where nothing near the place flooded there is NO estimate (null),
 * never a guess.
 */
import { load } from "../forecast/agents.ts";

type Ring = [number, number][];
const CELL_DEG_LAT = 50 / 110_600, CELL_DEG_LON = 50 / 98_600, CELL_KM2 = 0.0025;

function inRing(x: number, y: number, ring: Ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const ringAreaKm2 = (ring: Ring) => {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j]![0] - ring[i]![0]) * 98.6 * (ring[j]![1] + ring[i]![1]) * 110.6 / 2;
  return Math.abs(s);
};
type BBox = [number, number, number, number];
const bboxOf = (ring: Ring): BBox => ring.reduce<BBox>((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);

type Cell = { lon: number; lat: number; density: number };
let cells: Cell[] | null = null;
let densityNote = "";

function build(): Cell[] {
  const flood = load<{ geometry: { coordinates: Ring[][] } }>("real/kathmandu/flood_extent.geojson").geometry.coordinates;
  const wardGeo = load<{ features: { properties: { id: number }; geometry: { coordinates: Ring[] } }[] }>("real/kathmandu/ward_areas.geojson").features;
  const wardMeta = new Map(load<{ wards: { id: number; municipality: number; municipalityPop2021: number }[] }>("real/kathmandu/wards_bipad.json").wards.map((w) => [w.id, w]));
  // Density per municipality.
  const muni = new Map<number, { pop: number; area: number; wards: number }>();
  for (const f of wardGeo) {
    const m = wardMeta.get(f.properties.id); if (!m) continue;
    const e = muni.get(m.municipality) ?? { pop: m.municipalityPop2021, area: 0, wards: 0 };
    e.area += ringAreaKm2(f.geometry.coordinates[0] ?? []); e.wards++;
    muni.set(m.municipality, e);
  }
  const solid = [...muni.values()].filter((m) => m.wards >= 6 && m.area > 0).map((m) => m.pop / m.area).sort((a, b) => a - b);
  const median = solid[Math.floor(solid.length / 2)] ?? 5000;
  const density = new Map([...muni.entries()].map(([id, m]) => [id, m.wards >= 6 && m.area > 0 ? m.pop / m.area : median]));
  densityNote = `2021 census density by municipality (median ${Math.round(median).toLocaleString("en-US")} people/km²)`;
  const wards = wardGeo.map((f) => ({ ring: f.geometry.coordinates[0] ?? [], bb: bboxOf(f.geometry.coordinates[0] ?? []), muni: wardMeta.get(f.properties.id)?.municipality }));
  const out: Cell[] = [];
  for (const poly of flood) {
    const outer = poly[0] ?? [], holes = poly.slice(1), bb = bboxOf(outer);
    for (let y = bb[1] + CELL_DEG_LAT / 2; y < bb[3]; y += CELL_DEG_LAT) {
      for (let x = bb[0] + CELL_DEG_LON / 2; x < bb[2]; x += CELL_DEG_LON) {
        if (!inRing(x, y, outer) || holes.some((h) => inRing(x, y, h))) continue;
        const w = wards.find((w) => x >= w.bb[0] && x <= w.bb[2] && y >= w.bb[1] && y <= w.bb[3] && inRing(x, y, w.ring));
        out.push({ lon: x, lat: y, density: w?.muni !== undefined ? density.get(w.muni) ?? median : median });
      }
    }
  }
  return out;
}

export type NeedEstimate = { people: number | null; floodedKm2: number; radiusKm: number; basis: string };

/** People living on flooded ground within radiusKm of the point (upper-bound estimate), or null if nothing flooded there. */
export function needNear(lon: number, lat: number, radiusKm = 0.75): NeedEstimate {
  cells ??= build();
  let people = 0, n = 0;
  for (const c of cells) {
    if (Math.hypot((c.lon - lon) * 98.6, (c.lat - lat) * 110.6) <= radiusKm) { people += c.density * CELL_KM2; n++; }
  }
  return {
    people: n ? Math.round(people / 10) * 10 : null, floodedKm2: Math.round(n * CELL_KM2 * 100) / 100, radiusKm,
    basis: `Estimate: people living on ground the 2024 flood covered within ${radiusKm} km (UNOSAT extent × ${densityNote}). Upper bound.`,
  };
}

export type ExposedArea = { lon: number; lat: number; people: number; floodedKm2: number };

/**
 * The same flooded cells grouped into ~binKm squares: where the people on flooded ground live, area by area. Each area's point is
 * the population-weighted centre of its cells. Same upper-bound caveat as needNear. Largest first.
 */
export function exposedAreas(binKm = 1.5): { areas: ExposedArea[]; basis: string } {
  cells ??= build();
  const bins = new Map<string, { p: number; x: number; y: number; n: number }>();
  for (const c of cells) {
    const k = `${Math.floor((c.lon * 98.6) / binKm)}:${Math.floor((c.lat * 110.6) / binKm)}`;
    const p = c.density * CELL_KM2, b = bins.get(k) ?? { p: 0, x: 0, y: 0, n: 0 };
    b.p += p; b.x += c.lon * p; b.y += c.lat * p; b.n++;
    bins.set(k, b);
  }
  const areas = [...bins.values()].filter((b) => b.p > 0)
    .map((b) => ({ lon: b.x / b.p, lat: b.y / b.p, people: Math.round(b.p / 10) * 10, floodedKm2: Math.round(b.n * CELL_KM2 * 100) / 100 }))
    .sort((a, b) => b.people - a.people);
  return { areas, basis: `UNOSAT 2024 flood extent × ${densityNote}. Upper bound.` };
}

/** People living on flooded ground inside a polygon (even-odd over all rings, so holes and multi-part wards work). Upper bound. */
export function exposedIn(rings: Ring[]): { people: number; floodedKm2: number } {
  cells ??= build();
  const bb = rings.reduce<BBox>((b, r) => { const x = bboxOf(r); return [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])]; }, [Infinity, Infinity, -Infinity, -Infinity]);
  let people = 0, n = 0;
  for (const c of cells) {
    if (c.lon < bb[0] || c.lon > bb[2] || c.lat < bb[1] || c.lat > bb[3]) continue;
    if (rings.reduce((inside, r) => (inRing(c.lon, c.lat, r) ? !inside : inside), false)) { people += c.density * CELL_KM2; n++; }
  }
  return { people: Math.round(people / 10) * 10, floodedKm2: Math.round(n * CELL_KM2 * 100) / 100 };
}
