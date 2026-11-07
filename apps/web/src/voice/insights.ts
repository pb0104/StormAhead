import type { Entity, SceneSnapshot } from "../../../../packages/ports/index.ts";
import { POSTS } from "../real/social.ts";

export type LonLat = [number, number];
export type Bounds = [LonLat, LonLat];

function boundsOf(pts: LonLat[]): Bounds | null {
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

/** Official BIPAD Heavy Rainfall alerts (600 m circles already on the map). */
export function rainfallAlerts(scene: SceneSnapshot | null): {
  entities: Entity[];
  bounds: Bounds | null;
  count: number;
} {
  const entities = (scene?.entities ?? []).filter(
    (e) => e.kind === "alert" && String(e.props.hazard ?? "").toLowerCase().includes("rain"),
  );
  return { entities, count: entities.length, bounds: boundsOf(entities.map((e) => e.at)) };
}

/** Pick one rainfall alert, optionally near a place name. */
export function pickRainfallAlert(
  scene: SceneSnapshot | null,
  placeName?: string,
): Entity | null {
  const { entities } = rainfallAlerts(scene);
  if (!entities.length) return null;
  const q = placeName?.trim().toLowerCase();
  if (!q) return entities[0] ?? null;
  const hit = entities.find((e) => e.name.toLowerCase().includes(q));
  if (hit) return hit;
  const place = resolvePlace(scene, placeName!);
  if (!place.ok) return entities[0] ?? null;
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of entities) {
    const d = Math.hypot(e.at[0] - place.at[0], e.at[1] - place.at[1]);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export function affectedTowers(scene: SceneSnapshot | null): { entities: Entity[]; bounds: Bounds | null; down: number; risk: number } {
  const entities = (scene?.entities ?? []).filter(
    (e) => e.kind === "tower" && (e.props.status === "down" || e.props.status === "risk"),
  );
  const down = entities.filter((e) => e.props.status === "down").length;
  const risk = entities.filter((e) => e.props.status === "risk").length;
  return { entities, bounds: boundsOf(entities.map((e) => e.at)), down, risk };
}

/** Places (by named place string) with the most geolocated posts. */
export function socialHotspots(minPosts = 2): {
  places: { name: string; count: number; at: LonLat; ids: string[] }[];
  ids: string[];
  bounds: Bounds | null;
} {
  const by = new Map<string, { count: number; lon: number; lat: number; ids: string[] }>();
  for (const p of POSTS) {
    if (!(p.precision === "place" || p.precision === "town") || p.lon == null || p.lat == null) continue;
    const name = (p.places || "").trim() || "unnamed";
    const cur = by.get(name) ?? { count: 0, lon: 0, lat: 0, ids: [] };
    cur.count += 1;
    cur.lon += p.lon;
    cur.lat += p.lat;
    cur.ids.push(p.id);
    by.set(name, cur);
  }
  const places = [...by.entries()]
    .map(([name, v]) => ({
      name,
      count: v.count,
      at: [v.lon / v.count, v.lat / v.count] as LonLat,
      ids: v.ids,
    }))
    .filter((p) => p.count >= minPosts)
    .sort((a, b) => b.count - a.count);
  const ids = places.flatMap((p) => p.ids);
  return { places, ids, bounds: boundsOf(places.map((p) => p.at)) };
}

/** Resolve a spoken place/region to a map point or bounds (social place names + entity names). */
export function resolvePlace(
  scene: SceneSnapshot | null,
  query: string,
): { ok: true; name: string; at: LonLat; bounds: Bounds; match: string } | { ok: false; error: string; suggestions: string[] } {
  const q = query.trim().toLowerCase();
  if (!q) return { ok: false, error: "empty place name", suggestions: [] };

  const placeNames = new Map<string, LonLat[]>();
  for (const p of POSTS) {
    if (p.lon == null || p.lat == null) continue;
    for (const raw of [p.places, p.district]) {
      const name = (raw || "").trim();
      if (!name) continue;
      const list = placeNames.get(name) ?? [];
      list.push([p.lon, p.lat]);
      placeNames.set(name, list);
    }
  }

  const hitPlace = [...placeNames.entries()].filter(([n]) => n.toLowerCase().includes(q) || q.includes(n.toLowerCase()));
  if (hitPlace.length === 1) {
    const [name, pts] = hitPlace[0]!;
    const b = boundsOf(pts)!;
    const at: LonLat = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
    return { ok: true, name, at, bounds: b, match: "social-place" };
  }

  const ents = (scene?.entities ?? []).filter((e) => e.name.toLowerCase().includes(q));
  if (ents.length === 1) {
    const e = ents[0]!;
    return { ok: true, name: e.name, at: e.at, bounds: [e.at, e.at], match: "entity" };
  }

  const suggestions = [
    ...hitPlace.slice(0, 5).map(([n]) => n),
    ...ents.slice(0, 5).map((e) => e.name),
  ].slice(0, 8);
  return {
    ok: false,
    error: hitPlace.length > 1 || ents.length > 1 ? "ambiguous place name" : "place not found",
    suggestions,
  };
}
