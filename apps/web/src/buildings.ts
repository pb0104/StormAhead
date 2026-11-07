/**
 * Shelter layer: REAL pre-event OSM building footprints (7,115 shelter-relevant buildings, 2 Jan 2024, ODbL),
 * read from /api/buildings, joined to the console's flood-depth model.
 *
 * This is a sharper reading than the hindcast engine's. The engine's hazard is binary — a building is in the
 * observed extent or it is not — so it assumes a flooded building loses exactly one floor. Here the terrain and
 * weather agents give each flood patch a depth in metres, so the number of floors lost follows the actual water
 * depth and changes with the rain slider and the time selector.
 *
 * What stays true to the data: a building with no usable `building:levels` (20% of them) gets NO judgement.
 * Its height is unknown, and the output of this module is "send people upstairs" or "move them out".
 */
import type { Action, Entity, FloodPoly, Geometry, Reason } from "../../../packages/ports/index.ts";

/** Storey height, for turning water depth into floors lost. An assumption. */
export const FLOOR_H = 3;
/** Sphere minimum covered area per person, over this usable share of the footprint. Both assumptions. */
export const M2_PER_PERSON = 3.5, USABLE_FRACTION = 0.7;

export type Role = "at-risk-vertical" | "at-risk-evacuate" | "refuge" | "unknown-height" | "none";
export type RawBuilding = { i: number; id: number; name: string; t: string; f: number | null; a: number; inFlood: number; ring: [number, number][]; at: [number, number] };
export type Shelter = { role: Role; depthM: number; floorsLost: number; usableFloors: number | null; capacity: number | null };

export const ROLE_COLOR: Record<Role, string> = {
  "at-risk-vertical": "#FFB020",  // amber: stays put, upstairs
  "at-risk-evacuate": "#FF4A3D",  // red: must move
  refuge: "#86EFAC",              // green: can take people in
  "unknown-height": "#9BA8B0",    // grey: no judgement
  none: "#5E6E78",
};
export const ROLE_LABEL: Record<Role, string> = {
  "at-risk-vertical": "Shelter in place (upper floors)",
  "at-risk-evacuate": "Evacuate (no floor above the water)",
  refuge: "Refuge for a cut-off area",
  "unknown-height": "Height unknown — no judgement",
  none: "Not at risk",
};

const inRing = (lon: number, lat: number, ring: [number, number][]) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/** Water depth in metres at a point, from the depth the agents computed for each observed flood patch. */
export function depthAt(lon: number, lat: number, depths: number[], polys: FloodPoly[]): number {
  for (let i = 0; i < polys.length; i++) if (inRing(lon, lat, polys[i]!.ring)) return depths[i] ?? 0;
  return 0;
}

/**
 * The shelter reading for one building.
 * `cutOff` means the building sits in an area that lost its road access, so people there cannot easily be moved
 * out — which is exactly when a dry upper-floor building nearby becomes worth knowing about.
 */
export function shelterOf(floors: number | null, areaM2: number, depthM: number, cutOff: boolean): Shelter {
  const floorsLost = depthM > 0 ? Math.ceil(depthM / FLOOR_H) : 0;
  if (floors === null) {
    // An untagged height is only worth showing where the building is actually in play. A grey footprint
    // kilometres from any water would be noise, and would imply a question the map is not asking.
    const inPlay = depthM > 0 || cutOff;
    return { role: inPlay ? "unknown-height" : "none", depthM, floorsLost, usableFloors: null, capacity: null };
  }
  const usableFloors = Math.max(0, floors - floorsLost);
  const capacity = Math.floor((areaM2 * USABLE_FRACTION * usableFloors) / M2_PER_PERSON);
  const role: Role = depthM > 0
    ? (usableFloors >= 1 ? "at-risk-vertical" : "at-risk-evacuate")
    : cutOff && usableFloors >= 2 ? "refuge" : "none";
  return { role, depthM, floorsLost, usableFloors, capacity };
}

export type Assessed = RawBuilding & Shelter;

/** Assess every building against the current depth field. `cutOff` is tested against cut-off pockets. */
export function assess(list: RawBuilding[], depths: number[], polys: FloodPoly[], isCutOff: (lon: number, lat: number) => boolean): Assessed[] {
  return list.map((b) => {
    const depthM = depthAt(b.at[0], b.at[1], depths, polys);
    return { ...b, ...shelterOf(b.f, b.a, depthM, depthM === 0 && isCutOff(b.at[0], b.at[1])) };
  });
}

/** Centroid of a footprint ring (shoelace), used as the building's point for depth and distance tests. */
function centroid(ring: [number, number][]): [number, number] {
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
    a2 += cross; cx += (ring[j]![0] + ring[i]![0]) * cross; cy += (ring[j]![1] + ring[i]![1]) * cross;
  }
  if (Math.abs(a2) < 1e-12) return ring[0]!;
  return [cx / (3 * a2), cy / (3 * a2)];
}

export type BuildingLayer = { list: RawBuilding[]; meta: Record<string, unknown> | null };
/** Fetch the real footprints. Returns null when the dataset was never prepared, so the console runs without it. */
export async function fetchBuildings(): Promise<BuildingLayer | null> {
  try {
    const res = await fetch("/api/buildings");
    if (!res.ok) return null;
    const fc = await res.json();
    const list: RawBuilding[] = fc.features.map((f: any) => {
      const ring = f.geometry.coordinates[0] as [number, number][];
      return { ...f.properties, ring, at: centroid(ring) };
    });
    return { list, meta: fc.meta ?? null };
  } catch {
    return null; // offline, or the API is not running (pure static preview)
  }
}

/** A building as a selectable console entity, so it uses the same drawer and selection path as everything else. */
export function toEntity(b: Assessed): Entity {
  const geom: Geometry = { type: "Polygon", coordinates: [b.ring] };
  return {
    kind: "building", id: `BL-${b.id}`, name: b.name, at: b.at, geom,
    props: {
      type: b.t, floors: b.f ?? "", areaM2: b.a, role: b.role, roleLabel: ROLE_LABEL[b.role],
      depthM: Math.round(b.depthM * 10) / 10, floorsLost: b.floorsLost,
      usableFloors: b.usableFloors ?? "", capacity: b.capacity ?? "",
    },
  };
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Invented evidence and response cards for a selected shelter-reading building. */
export function buildingAdvice(e: Entity): { reasons: Reason[]; actions: Action[] } {
  const floors = e.props.floors === "" ? null : Number(e.props.floors);
  const depth = Number(e.props.depthM), lost = Number(e.props.floorsLost);
  const cap = Number(e.props.capacity) || 0;
  const reasons: Reason[] = [
    { input: "Buildings (REAL, OpenStreetMap 2 Jan 2024)", text: floors === null
      ? `${e.props.type}, ${fmt(e.props.areaM2 as number)} m² footprint. Height is NOT tagged in OpenStreetMap, so no shelter judgement is offered for this building.`
      : `${e.props.type}, ${floors} storey${floors === 1 ? "" : "s"}, ${fmt(e.props.areaM2 as number)} m² footprint.` },
    { input: "Flood depth (terrain + weather agents)", text: depth > 0
      ? `About ${depth.toFixed(1)} m of water here, so the lowest ${lost} floor${lost === 1 ? "" : "s"} ${lost === 1 ? "is" : "are"} unusable.`
      : "No water on this building in the current forecast." },
  ];
  if (floors !== null) {
    reasons.push({ input: "Assessment", text: e.props.role === "at-risk-evacuate"
      ? "No floor stays above the water, so people cannot shelter here."
      : e.props.role === "at-risk-vertical" ? `${e.props.usableFloors} floor(s) stay above the water: about ${fmt(cap)} places at 3.5 m² per person.`
      : e.props.role === "refuge" ? `Dry, and inside an area that has lost road access. ${e.props.usableFloors} usable floor(s), about ${fmt(cap)} places.`
      : "Dry and still reachable by road." });
  }
  const actions: Action[] = [];
  if (e.props.role === "at-risk-evacuate") {
    const n = Math.max(20, Math.round((e.props.areaM2 as number) / 12));
    actions.push(
      { id: `${e.id}:evac`, kind: "shelter", title: `Evacuate everyone in ${e.name}`, detail: `About ${fmt(n)} people. No floor stays above the water.` },
      { id: `${e.id}:alert`, kind: "alert", title: "Issue public alert", detail: "Tell people to leave before water rises further.", alertEn: `Evacuate ${e.name}. No upper floor stays dry.`, alertNe: `${e.name} बाट बाहिरिनुहोस्।` },
    );
  } else if (e.props.role === "at-risk-vertical") {
    actions.push(
      { id: `${e.id}:road`, kind: "road", title: `Move people to the upper floors of ${e.name}`, detail: `${e.props.usableFloors} floor(s) stay above about ${depth.toFixed(1)} m of water: room for about ${fmt(cap)}. Send water and light, not transport.` },
      { id: `${e.id}:army`, kind: "army", title: "Request boats to reach the upper floors", detail: "Ground floor is under water." },
      { id: `${e.id}:food`, kind: "food", title: `Send food for about ${fmt(cap)}`, detail: "Upper-floor shelter in place." },
    );
  } else if (e.props.role === "refuge") {
    actions.push(
      { id: `${e.id}:shelter`, kind: "shelter", title: `Open ${e.name} as a local refuge`, detail: `Dry, ${e.props.usableFloors} usable floor(s), about ${fmt(cap)} places. The area has lost road access, so shelter people here rather than moving them out.`, targetId: e.id },
      { id: `${e.id}:food`, kind: "food", title: `Send food for about ${fmt(cap)}`, detail: "Local refuge in a cut-off area." },
    );
  }
  return { reasons, actions };
}
