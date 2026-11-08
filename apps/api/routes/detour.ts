/**
 * "If this bridge goes down, how do we get across?" — detours on the real pre-event OSM road network.
 *
 * The bridge (all its OSM segments) is removed; optionally every segment the flood-closure rule closes is removed too
 * (same rule as the cascade engine: a bridge touching the observed flood extent, or a road >= 30% flooded). Then the
 * fastest path between the two ends of the bridge is found, plus a second, different route (edges of the first one
 * are penalised, not removed). Travel times are free-flow OSM estimates, not live traffic.
 */
import { DEFAULT_PARAMS, isClosed, type RealEdge } from "../../../packages/analysis/cascade.ts";
import { landmarkAt, load, nearestPlace } from "../forecast/agents.ts";

type Pt = [number, number];
type Net = { nodes: Pt[]; edges: RealEdge[] };

let net: Net | null = null;
function network(): Net {
  if (net) return net;
  const raw = load<{ nodes: Pt[]; edgeFields: string[]; edges: unknown[][] }>("real/kathmandu/network.json");
  const f = (k: string) => raw.edgeFields.indexOf(k);
  const ix = { u: f("u"), v: f("v"), minutes: f("minutes"), lengthM: f("lengthM"), cls: f("class"), bridge: f("bridge"), floodedShare: f("floodedShare"),
    name: f("name"), osmWayId: f("osmWayId"), mid: f("mid"), distFloodM: f("distFloodM"), via: raw.edgeFields.findIndex((k) => k.startsWith("via")) };
  const edges = raw.edges.map((e) => ({
    u: e[ix.u] as number, v: e[ix.v] as number, minutes: Number(e[ix.minutes]), lengthM: Number(e[ix.lengthM]), cls: String(e[ix.cls]),
    bridge: !!e[ix.bridge], floodedShare: Number(e[ix.floodedShare] ?? 0), name: (e[ix.name] as string | null) ?? null, osmWayId: Number(e[ix.osmWayId]),
    mid: e[ix.mid] as Pt, distFloodM: Number(e[ix.distFloodM] ?? 0), via: (e[ix.via] as Pt[] | null) ?? null,
  }));
  return (net = { nodes: raw.nodes, edges });
}

const KX = 98600, KY = 110600;
const distM = (a: Pt, b: Pt) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);

/** Dijkstra from s to t over edges not in `skip`, with optional per-edge weight multipliers. Returns edge path. */
function shortest(n: Net, s: number, t: number, skip: Set<number>, mult?: Map<number, number>): { minutes: number; path: number[] } | null {
  const N = n.nodes.length;
  const adj: [number, number][][] = Array.from({ length: N }, () => []);
  n.edges.forEach((e, i) => { if (!skip.has(i)) { adj[e.u]!.push([e.v, i]); adj[e.v]!.push([e.u, i]); } });
  const dist = new Float64Array(N).fill(Infinity), via = new Int32Array(N).fill(-1);
  dist[s] = 0;
  // Small binary heap of [dist, node].
  const heap: [number, number][] = [[0, s]];
  const push = (x: [number, number]) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p]![0] <= heap[i]![0]) break; [heap[p], heap[i]] = [heap[i]!, heap[p]!]; i = p; } };
  const pop = () => { const top = heap[0]!, last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l; if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i]!, heap[m]!]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop();
    if (u === t) break;
    if (d > dist[u]!) continue;
    for (const [w, ei] of adj[u]!) {
      const nd = d + n.edges[ei]!.minutes * (mult?.get(ei) ?? 1);
      if (nd < dist[w]!) { dist[w] = nd; via[w] = ei; push([nd, w]); }
    }
  }
  if (!Number.isFinite(dist[t]!)) return null;
  const path: number[] = [];
  for (let x = t; x !== s;) { const ei = via[x]!; path.push(ei); const e = n.edges[ei]!; x = e.u === x ? e.v : e.u; }
  path.reverse();
  return { minutes: path.reduce((a, ei) => a + n.edges[ei]!.minutes, 0), path };
}

/** Edge geometry in travel direction. */
function edgeCoords(n: Net, ei: number, from: number): Pt[] {
  const e = n.edges[ei]!;
  const pts: Pt[] = [n.nodes[e.u]!, ...(e.via ?? []), n.nodes[e.v]!];
  return from === e.u ? pts : pts.reverse();
}
function pathCoords(n: Net, start: number, path: number[]): Pt[] {
  const out: Pt[] = []; let at = start;
  for (const ei of path) { const c = edgeCoords(n, ei, at); out.push(...(out.length ? c.slice(1) : c)); const e = n.edges[ei]!; at = e.u === at ? e.v : e.u; }
  return out;
}
/** The main named roads a path uses, longest first. */
function viaNames(n: Net, path: number[]): string[] {
  const by = new Map<string, number>();
  for (const ei of path) { const e = n.edges[ei]!; const nm = e.name && /[A-Za-z]/.test(e.name) ? e.name : null; if (nm) by.set(nm, (by.get(nm) ?? 0) + e.lengthM); }
  return [...by].sort((a, b) => b[1] - a[1]).filter(([, m]) => m >= 150).slice(0, 4).map(([nm]) => nm);
}

export type DetourResult =
  | { ok: false; error: string }
  | {
    ok: true; crossing: { name: string; kind: "bridge" | "road"; at: Pt; coords: Pt[][]; lengthM: number; closedByFlood: boolean };
    normalMinutes: number; avoidFlood: boolean; avoidedSegments: number;
    routes: { rank: number; minutes: number; extraMinutes: number; km: number; via: string[]; coords: Pt[] }[];
    endpoints: { from: Pt; to: Pt; movedM: number };
    note: string;
  };

/**
 * Detours around the bridge (or road) nearest to `at`. avoidFlood also removes every segment the flood closes.
 */
export function detourAround(at: Pt, opts: { avoidFlood?: boolean } = {}): DetourResult {
  const n = network(), avoidFlood = opts.avoidFlood ?? true;
  // 1. The crossing: nearest bridge within 300 m, else the nearest road segment within 150 m. Whole OSM way.
  let best = -1, bd = Infinity;
  n.edges.forEach((e, i) => { if (!e.bridge) return; const d = distM(e.mid, at); if (d < bd) { bd = d; best = i; } });
  if (best < 0 || bd > 300) {
    best = -1; bd = Infinity;
    n.edges.forEach((e, i) => { const d = distM(e.mid, at); if (d < bd) { bd = d; best = i; } });
    if (best < 0 || bd > 150) return { ok: false, error: "No bridge or road within 300 m of that point." };
  }
  const hit = n.edges[best]!;
  const sameWay = n.edges.map((e, i) => [e, i] as const)
    .filter(([e]) => e.osmWayId === hit.osmWayId && e.bridge === hit.bridge && distM(e.mid, hit.mid) < 600);
  // A dual carriageway (e.g. the Ring Road at Balkhu) is two parallel bridges: if one goes down, so does its twin.
  const twins = hit.bridge ? n.edges.map((e, i) => [e, i] as const)
    .filter(([e]) => e.bridge && e.osmWayId !== hit.osmWayId && sameWay.some(([s]) => distM(e.mid, s.mid) < 80)) : [];
  const crossingIdx = [...sameWay, ...twins].map(([, i]) => i);
  const crossingSet = new Set(crossingIdx);
  // 2. Its two ends: the crossing's nodes that touch other roads, farthest apart.
  const deg = new Map<number, number>();
  n.edges.forEach((e, i) => { if (!crossingSet.has(i)) { deg.set(e.u, (deg.get(e.u) ?? 0) + 1); deg.set(e.v, (deg.get(e.v) ?? 0) + 1); } });
  const ends = [...new Set(crossingIdx.flatMap((i) => [n.edges[i]!.u, n.edges[i]!.v]))].filter((x) => (deg.get(x) ?? 0) > 0);
  if (ends.length < 2) return { ok: false, error: "That crossing has no road on one side, so there is nothing to detour between." };
  let A = ends[0]!, B = ends[1]!, far = -1;
  for (const a of ends) for (const b of ends) { const d = distM(n.nodes[a]!, n.nodes[b]!); if (d > far) { far = d; A = a; B = b; } }

  // 3. What is removed: the crossing, plus flood-closed segments if asked.
  const skip = new Set(crossingIdx);
  let avoided = 0;
  if (avoidFlood) n.edges.forEach((e, i) => { if (!skip.has(i) && isClosed(e, DEFAULT_PARAMS)) { skip.add(i); avoided++; } });

  // Flooded approach roads can strand the bridge ends themselves; start from the nearest node on the same side that
  // still has an open road (within 1.5 km), and say how far the start moved.
  const open = new Set<number>();
  n.edges.forEach((e, i) => { if (!skip.has(i)) { open.add(e.u); open.add(e.v); } });
  const nearestOpen = (x: number, other: number): number | null => {
    if (open.has(x)) return x;
    let b = -1, d0 = Infinity;
    for (const k of open) {
      const p = n.nodes[k]!, d = distM(p, n.nodes[x]!);
      if (d < d0 && d < 1500 && d < distM(p, n.nodes[other]!)) { d0 = d; b = k; }
    }
    return b >= 0 ? b : null;
  };
  const A2 = nearestOpen(A, B), B2 = nearestOpen(B, A);
  if (A2 == null || B2 == null) return { ok: false, error: "Both approaches are flooded for over 1.5 km; no detour start point." };

  const normal = shortest(n, A, B, new Set());
  const r1 = shortest(n, A2, B2, skip);
  if (!r1) return { ok: false, error: avoidFlood ? "No open route connects the two sides once flooded roads are removed: the far side is cut off." : "No other road connects the two sides." };
  // Second option: same graph, but the first route costs 4x, so a genuinely different route wins if one exists.
  const r2 = shortest(n, A2, B2, skip, new Map(r1.path.map((ei) => [ei, 4])));
  const routes = [r1];
  if (r2) {
    const s1 = new Set(r1.path), shared = r2.path.filter((ei) => s1.has(ei)).length / Math.max(1, r2.path.length);
    if (shared < 0.6 && r2.minutes <= r1.minutes * 2.2) routes.push(r2);
  }
  const lenM = (p: number[]) => p.reduce((a, ei) => a + n.edges[ei]!.lengthM, 0);
  const base = normal?.minutes ?? 0;
  const name = landmarkAt(hit.mid, 0.3) ?? (hit.name && /[A-Za-z]/.test(hit.name) ? hit.name : `${hit.bridge ? "Bridge" : "Road"} near ${nearestPlace(hit.mid)}`);
  const movedM = Math.round(distM(n.nodes[A]!, n.nodes[A2]!) + distM(n.nodes[B]!, n.nodes[B2]!));
  return {
    ok: true,
    crossing: {
      name, kind: hit.bridge ? "bridge" : "road", at: hit.mid, coords: crossingIdx.map((i) => edgeCoords(n, i, n.edges[i]!.u)),
      lengthM: Math.round(crossingIdx.reduce((a, i) => a + n.edges[i]!.lengthM, 0)), closedByFlood: crossingIdx.some((i) => isClosed(n.edges[i]!, DEFAULT_PARAMS)),
    },
    normalMinutes: Math.round(base * 10) / 10, avoidFlood, avoidedSegments: avoided,
    routes: routes.map((r, k) => ({
      rank: k + 1, minutes: Math.round(r.minutes * 10) / 10, extraMinutes: Math.round((r.minutes - base) * 10) / 10,
      km: Math.round(lenM(r.path) / 100) / 10, via: viaNames(n, r.path), coords: pathCoords(n, A2, r.path),
    })),
    endpoints: { from: n.nodes[A2]!, to: n.nodes[B2]!, movedM },
    note: `Detours between the two ends of ${name} on the pre-event OSM road network with free-flow travel times (not live traffic).` +
      (avoidFlood ? ` ${avoided} segments closed by the observed 30 Sep 2024 flood are also avoided.` : " Flooded roads are NOT avoided.") +
      (movedM > 50 ? ` The bridge approaches are flooded, so routes start and end ${movedM} m away on open roads.` : ""),
  };
}
