/**
 * Hindcast cascade-impact engine for a REAL area.
 *
 * Hazard is a GIVEN input (observed flood extent pre-processed into per-edge floodedShare / per-place inFlood);
 * nothing here predicts the flood. The model derives knock-on effects through the road network:
 *   direct    = place/hospital inside the flood extent
 *   cascade   = dry place whose access to an available hospital is lost (isolated) or badly degraded
 *   stranded  = dry, open road segments cut off from the main network
 * Ground-truth incident reports are NEVER an input to analyzeCascade — they only enter scoreAgainstIncidents.
 */
export type RealEdge = {
  u: number; v: number; minutes: number; lengthM: number; cls: string; bridge: boolean; floodedShare: number;
  name: string | null; osmWayId: number; mid: [number, number]; distFloodM: number; via: [number, number][] | null;
};
export type RealPoint = { id: number; name: string; lon: number; lat: number; node: number; inFlood: boolean; distFloodM: number; type?: string };
/**
 * A shelter-relevant building (OSM footprint, pre-event). `floors` is null when building:levels is absent or
 * implausible — that is UNKNOWN and must never be filled in with a guess, because the shelter judgement below
 * turns directly into "send people upstairs" or "move them out".
 */
export type RealBuilding = RealPoint & { floors: number | null; areaM2: number };
export type RealArea = { nodes: [number, number][]; edges: RealEdge[]; places: RealPoint[]; hospitals: RealPoint[]; buildings?: RealBuilding[] };

/** Shelter assumptions, all documented rather than measured. */
export const SHELTER = {
  /** Floors lost to the water when a building stands in the flood extent. The engine's hazard is binary
   *  (in / out of the observed extent), so it cannot tell 0.3 m from 3 m: one floor is the optimistic case. */
  floorsLostWhenFlooded: 1,
  /** Sphere minimum covered area per person. */
  m2PerPerson: 3.5,
  /** Share of footprint area that is usable floor space (walls, stairwells, services removed). */
  usableFraction: 0.7,
};

/**
 * What the building can be used for, given the hazard and its height.
 *  at-risk-vertical : stands in the flood, but has floors above the water — shelter in place
 *  at-risk-evacuate : stands in the flood with no floor above the water — move people out
 *  refuge           : dry, upper floors, and sits in an area that lost hospital access — a local shelter option
 *                     precisely because people there cannot easily be moved out
 *  unknown-height   : height not tagged, so no judgement is offered
 *  none             : dry and not cut off
 */
export type ShelterRole = "at-risk-vertical" | "at-risk-evacuate" | "refuge" | "unknown-height" | "none";
export type BuildingResult = {
  index: number; status: PlaceStatus; t0: number | null; t1: number | null;
  role: ShelterRole; usableFloors: number | null; capacity: number | null;
};

export type CascadeParams = {
  /** Edge closed when at least this share of its length lies in the flood extent. */
  closeShare: number;
  /** Any bridge touching the flood extent is treated as closed (documented modelling choice). */
  bridgeClosesOnAnyContact: boolean;
  /** A dry place is "degraded" if hospital access time grows by >= this many minutes AND by >= ratio. */
  degradeMinutes: number;
  degradeRatio: number;
};
export const DEFAULT_PARAMS: CascadeParams = { closeShare: 0.3, bridgeClosesOnAnyContact: true, degradeMinutes: 10, degradeRatio: 1.5 };

export type PlaceStatus = "direct" | "cascade-isolated" | "cascade-degraded" | "unaffected" | "no-baseline";
export type CascadeResult = {
  params: CascadeParams;
  exposedEdges: number[]; closedEdges: number[]; strandedEdges: number[];
  places: { index: number; status: PlaceStatus; t0: number | null; t1: number | null }[];
  hospitals: { index: number; inFlood: boolean; disconnected: boolean }[];
  buildings: BuildingResult[];
  counts: Record<string, number>;
};

// ---------- fast graph utilities ----------
type Adj = { to: number; w: number }[][];
function buildAdj(n: number, edges: RealEdge[], skip: (i: number) => boolean): Adj {
  const adj: Adj = Array.from({ length: n }, () => []);
  edges.forEach((e, i) => { if (skip(i)) return; adj[e.u]!.push({ to: e.v, w: e.minutes }); adj[e.v]!.push({ to: e.u, w: e.minutes }); });
  return adj;
}
class MinHeap {
  private k: number[] = []; private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    this.k.push(key); this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p]! <= this.k[i]!) break; this.swap(i, p); i = p; }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.k[0]!, this.v[0]!];
    const lk = this.k.pop()!, lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < this.k.length && this.k[l]! < this.k[m]!) m = l;
        if (r < this.k.length && this.k[r]! < this.k[m]!) m = r;
        if (m === i) break; this.swap(i, m); i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) { [this.k[a], this.k[b]] = [this.k[b]!, this.k[a]!]; [this.v[a], this.v[b]] = [this.v[b]!, this.v[a]!]; }
}
/** Multi-source Dijkstra. Unreachable = Infinity internally; callers convert to null. */
export function multiSourceDijkstra(adj: Adj, sources: number[]): Float64Array {
  const dist = new Float64Array(adj.length).fill(Infinity);
  const h = new MinHeap();
  for (const s of sources) { dist[s] = 0; h.push(0, s); }
  while (h.size) {
    const [d, u] = h.pop();
    if (d > dist[u]!) continue;
    for (const { to, w } of adj[u]!) { const nd = d + w; if (nd < dist[to]!) { dist[to] = nd; h.push(nd, to); } }
  }
  return dist;
}
function componentLabels(adj: Adj): { label: Int32Array; sizes: Map<number, number> } {
  const label = new Int32Array(adj.length).fill(-1); const sizes = new Map<number, number>(); let c = 0;
  for (let s = 0; s < adj.length; s++) {
    if (label[s] !== -1 || adj[s]!.length === 0) continue;
    const stack = [s]; label[s] = c; let n = 0;
    while (stack.length) { const u = stack.pop()!; n++; for (const { to } of adj[u]!) if (label[to] === -1) { label[to] = c; stack.push(to); } }
    sizes.set(c++, n);
  }
  return { label, sizes };
}

export function isClosed(e: RealEdge, p: CascadeParams): boolean {
  return e.floodedShare > 0 && ((e.bridge && p.bridgeClosesOnAnyContact) || e.floodedShare >= p.closeShare);
}

export function analyzeCascade(area: RealArea, params: CascadeParams = DEFAULT_PARAMS): CascadeResult {
  const n = area.nodes.length;
  const closedFlag = area.edges.map((e) => isClosed(e, params));
  const base = buildAdj(n, area.edges, () => false);
  const now = buildAdj(n, area.edges, (i) => closedFlag[i]!);

  const hospBase = area.hospitals.map((h) => h.node);
  const hospNow = area.hospitals.filter((h) => !h.inFlood).map((h) => h.node); // a flooded hospital is unavailable
  const t0 = multiSourceDijkstra(base, hospBase);
  const t1 = multiSourceDijkstra(now, hospNow);

  const places = area.places.map((p, index) => {
    const a = t0[p.node]!, b = t1[p.node]!;
    const T0 = Number.isFinite(a) ? a : null, T1 = Number.isFinite(b) ? b : null;
    let status: PlaceStatus;
    if (p.inFlood) status = "direct";
    else if (T0 === null) status = "no-baseline";
    else if (T1 === null) status = "cascade-isolated";
    else if (T1 - T0 >= params.degradeMinutes && T1 / Math.max(T0, 0.5) >= params.degradeRatio) status = "cascade-degraded";
    else status = "unaffected";
    return { index, status, t0: T0, t1: T1 };
  });

  // Buildings are scored for access exactly like places, then given a shelter/evacuate reading.
  const buildings: BuildingResult[] = (area.buildings ?? []).map((b, index) => {
    const a = t0[b.node]!, c = t1[b.node]!;
    const T0 = Number.isFinite(a) ? a : null, T1 = Number.isFinite(c) ? c : null;
    let status: PlaceStatus;
    if (b.inFlood) status = "direct";
    else if (T0 === null) status = "no-baseline";
    else if (T1 === null) status = "cascade-isolated";
    else if (T1 - T0 >= params.degradeMinutes && T1 / Math.max(T0, 0.5) >= params.degradeRatio) status = "cascade-degraded";
    else status = "unaffected";

    const cutOff = status === "cascade-isolated" || status === "cascade-degraded";
    if (b.floors === null) return { index, status, t0: T0, t1: T1, role: "unknown-height", usableFloors: null, capacity: null };
    const usableFloors = Math.max(0, b.floors - (b.inFlood ? SHELTER.floorsLostWhenFlooded : 0));
    const capacity = Math.floor((b.areaM2 * SHELTER.usableFraction * usableFloors) / SHELTER.m2PerPerson);
    const role: ShelterRole = b.inFlood
      ? (usableFloors >= 1 ? "at-risk-vertical" : "at-risk-evacuate")
      : cutOff && usableFloors >= 2 ? "refuge" : "none";
    return { index, status, t0: T0, t1: T1, role, usableFloors, capacity };
  });

  const { label, sizes } = componentLabels(now);
  let main = -1, best = -1;
  for (const [c, s] of sizes) if (s > best) { best = s; main = c; }
  const strandedEdges: number[] = [], exposedEdges: number[] = [], closedEdges: number[] = [];
  area.edges.forEach((e, i) => {
    if (e.floodedShare > 0) exposedEdges.push(i);
    if (closedFlag[i]) closedEdges.push(i);
    else if (e.floodedShare === 0 && label[e.u] !== main) strandedEdges.push(i); // dry, open, but cut off from the main network
  });
  const hospitals = area.hospitals.map((h, index) => ({ index, inFlood: h.inFlood, disconnected: label[h.node] !== main }));

  const count = (s: PlaceStatus) => places.filter((p) => p.status === s).length;
  const bRole = (r: ShelterRole) => buildings.filter((b) => b.role === r).length;
  return {
    params, exposedEdges, closedEdges, strandedEdges, places, hospitals, buildings,
    counts: {
      buildings: buildings.length,
      buildingsFlooded: buildings.filter((b) => b.status === "direct").length,
      buildingsIsolated: buildings.filter((b) => b.status === "cascade-isolated").length,
      buildingsDegraded: buildings.filter((b) => b.status === "cascade-degraded").length,
      buildingsUnknownHeight: bRole("unknown-height"),
      shelterVertical: bRole("at-risk-vertical"), shelterEvacuate: bRole("at-risk-evacuate"), shelterRefuge: bRole("refuge"),
      refugeCapacity: buildings.filter((b) => b.role === "refuge").reduce((s, b) => s + (b.capacity ?? 0), 0),
      edges: area.edges.length, exposedEdges: exposedEdges.length, closedEdges: closedEdges.length,
      closedBridges: closedEdges.filter((i) => area.edges[i]!.bridge).length, strandedEdges: strandedEdges.length,
      places: places.length, direct: count("direct"), cascadeIsolated: count("cascade-isolated"), cascadeDegraded: count("cascade-degraded"),
      unaffected: count("unaffected"), noBaseline: count("no-baseline"),
      hospitals: area.hospitals.length, hospitalsFlooded: hospitals.filter((h) => h.inFlood).length, hospitalsDisconnected: hospitals.filter((h) => h.disconnected && !h.inFlood).length,
    },
  };
}

// ---------------- scoring against independent incident reports (evaluation only) ----------------
export type Incident = {
  id: number; title: string; lon: number; lat: number; hazard: string; floodRelated: boolean; hasImpact: boolean; distFloodM: number; incidentOn: string;
  loss: Record<string, number>;
};
export type ScoreOptions = {
  radiusM: number; directBufferM: number; primaryHazards: string[]; permutations: number; seed: number;
  /** Add cut-off buildings to the predicted-item set (and to the random pool they are drawn against).
   *  Off by default so the published headline keeps its original target set. */
  includeBuildings: boolean;
  /** Score ONLY cut-off buildings, dropping stranded roads. Tests whether a sharper, sparser target set
   *  does better than the road-dominated one. Implies includeBuildings. */
  buildingsOnly: boolean;
};
export const DEFAULT_SCORE: ScoreOptions = { radiusM: 1000, directBufferM: 100, primaryHazards: ["Flood", "Inundation", "Heavy Rainfall"], permutations: 2000, seed: 20240927, includeBuildings: false, buildingsOnly: false };

const KX = 98600, KY = 110600;
const dm = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export type ScoreResult = {
  options: ScoreOptions;
  evaluated: number; inFlood: number; outsideFlood: number; outsideCovered: number; outsideRecall: number | null;
  randomBaseline: { meanCovered: number; p: number };         // same-size random dry items
  proximityBaseline: { covered: number };                       // same-size dry items nearest the flood (no network reasoning)
  flagged: { places: number; edges: number; buildings: number };
  incidents: { id: number; title: string; hazard: string; distFloodM: number; zone: "in-flood" | "outside-flood"; coveredByCascade: boolean | null }[];
};

export function scoreAgainstIncidents(area: RealArea, res: CascadeResult, all: Incident[], opt: ScoreOptions = DEFAULT_SCORE): ScoreResult {
  const inc = all.filter((i) => i.floodRelated && i.hasImpact && opt.primaryHazards.includes(i.hazard));
  const outside = inc.filter((i) => i.distFloodM > opt.directBufferM);
  const pts = outside.map((i) => [i.lon, i.lat] as [number, number]);

  type Item = { pos: [number, number]; dist: number; cov: number[] };
  const mk = (pos: [number, number], dist: number): Item => ({ pos, dist, cov: pts.flatMap((p, k) => (dm(pos, p) <= opt.radiusM ? [k] : [])) });

  const cut = (s: PlaceStatus) => s === "cascade-isolated" || s === "cascade-degraded";
  const dry = (s: PlaceStatus) => s === "unaffected" || cut(s);
  const withBuildings = opt.includeBuildings || opt.buildingsOnly;
  const allBuildings = area.buildings ?? [];

  const flaggedPlaces = res.places.filter((p) => cut(p.status)).map((p) => area.places[p.index]!);
  const flaggedBuildings = withBuildings ? res.buildings.filter((b) => cut(b.status)).map((b) => allBuildings[b.index]!) : [];
  const strandedUsed = opt.buildingsOnly ? [] : res.strandedEdges;
  const placesUsed = opt.buildingsOnly ? [] : flaggedPlaces;
  const flaggedItems: Item[] = [
    ...placesUsed.map((p) => mk([p.lon, p.lat], p.distFloodM)),
    ...strandedUsed.map((i) => mk(area.edges[i]!.mid, area.edges[i]!.distFloodM)),
    ...flaggedBuildings.map((b) => mk([b.lon, b.lat], b.distFloodM)),
  ];
  const closed = new Set(res.closedEdges);
  const placePool = res.places.filter((p) => dry(p.status)).map((p) => area.places[p.index]!);
  const edgePool = area.edges.map((e, i) => ({ e, i })).filter(({ e, i }) => e.floodedShare === 0 && !closed.has(i));
  const buildingPool = withBuildings ? res.buildings.filter((b) => dry(b.status)).map((b) => allBuildings[b.index]!) : [];
  const placeItems = placePool.map((p) => mk([p.lon, p.lat], p.distFloodM));
  const edgeItems = edgePool.map(({ e }) => mk(e.mid, e.distFloodM));
  const buildingItems = buildingPool.map((b) => mk([b.lon, b.lat], b.distFloodM));

  const union = (items: Item[]) => { const s = new Set<number>(); for (const it of items) for (const k of it.cov) s.add(k); return s.size; };
  const observed = union(flaggedItems);
  // Each baseline draws the SAME number of items of each class as the model flagged, from the dry pool of that
  // class, so a larger target set cannot flatter the model: the baselines grow with it.
  const kP = placesUsed.length, kE = strandedUsed.length, kB = flaggedBuildings.length;

  const rnd = mulberry32(opt.seed);
  const sample = <T,>(pool: T[], k: number): T[] => {
    const a = pool.slice(); const m = Math.min(k, a.length);
    for (let i = 0; i < m; i++) { const j = i + Math.floor(rnd() * (a.length - i)); [a[i], a[j]] = [a[j]!, a[i]!]; }
    return a.slice(0, m);
  };
  let ge = 0, sum = 0;
  for (let t = 0; t < opt.permutations; t++) {
    const c = union([...sample(placeItems, kP), ...sample(edgeItems, kE), ...sample(buildingItems, kB)]);
    sum += c; if (c >= observed) ge++;
  }

  const byDist = (items: Item[], k: number) => items.slice().sort((a, b) => a.dist - b.dist).slice(0, k);
  const prox = union([...byDist(placeItems, kP), ...byDist(edgeItems, kE), ...byDist(buildingItems, kB)]);

  const covered = new Set<number>(); flaggedItems.forEach((it) => it.cov.forEach((k) => covered.add(k)));
  return {
    options: opt, evaluated: inc.length, inFlood: inc.length - outside.length, outsideFlood: outside.length, outsideCovered: observed,
    outsideRecall: outside.length ? observed / outside.length : null,
    randomBaseline: { meanCovered: sum / opt.permutations, p: (ge + 1) / (opt.permutations + 1) },
    proximityBaseline: { covered: prox }, flagged: { places: kP, edges: kE, buildings: kB },
    incidents: inc.map((i) => {
      const k = outside.indexOf(i);
      return { id: i.id, title: i.title, hazard: i.hazard, distFloodM: i.distFloodM, zone: k === -1 ? "in-flood" as const : "outside-flood" as const, coveredByCascade: k === -1 ? null : covered.has(k) };
    }),
  };
}
