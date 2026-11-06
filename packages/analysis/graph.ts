import type { RoadEdge } from "../shared/schemas.ts";

export type Graph = Map<string, { to: string; minutes: number; edgeId: string }[]>;

/** Build an undirected graph from road edges, omitting closed ones. */
export function buildGraph(roads: RoadEdge[], closed: ReadonlySet<string> = new Set(), nodeIds: string[] = []): Graph {
  const g: Graph = new Map();
  for (const n of nodeIds) g.set(n, []);
  for (const r of roads) {
    if (!g.has(r.from)) g.set(r.from, []);
    if (!g.has(r.to)) g.set(r.to, []);
    if (closed.has(r.id)) continue;
    g.get(r.from)!.push({ to: r.to, minutes: r.travelMinutes, edgeId: r.id });
    g.get(r.to)!.push({ to: r.from, minutes: r.travelMinutes, edgeId: r.id });
  }
  return g;
}

/** Dijkstra from a source. Unreachable nodes are ABSENT from the result (never Infinity-as-number). */
export function dijkstra(g: Graph, source: string): Map<string, number> {
  const dist = new Map<string, number>();
  if (!g.has(source)) return dist;
  dist.set(source, 0);
  const done = new Set<string>();
  // Graph is tiny: O(V^2) selection keeps this dependency-free and obviously correct.
  for (;;) {
    let u: string | null = null;
    let best = Infinity;
    for (const [n, d] of dist) if (!done.has(n) && d < best) ((best = d), (u = n));
    if (u === null) break;
    done.add(u);
    for (const e of g.get(u) ?? []) {
      const nd = best + e.minutes;
      if (nd < (dist.get(e.to) ?? Infinity)) dist.set(e.to, nd);
    }
  }
  return dist;
}

/** Connected components (sorted for determinism). */
export function components(g: Graph): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const start of [...g.keys()].sort()) {
    if (seen.has(start)) continue;
    const comp = [...dijkstra(g, start).keys()].sort();
    comp.forEach((n) => seen.add(n));
    out.push(comp);
  }
  return out;
}
