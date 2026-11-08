import type { Entity, SceneSnapshot } from "../../../../packages/ports/index.ts";
import { POSTS, TAG_LABEL, whenLocal, type Post } from "../real/social.ts";

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

  const scoreName = (n: string) => {
    const nl = n.toLowerCase();
    if (nl === q) return 0;
    if (nl.startsWith(q) || q.startsWith(nl)) return 1;
    if (nl.includes(q) || q.includes(nl)) return 2;
    return 9;
  };

  const hitPlace = [...placeNames.entries()]
    .filter(([n]) => scoreName(n) < 9)
    .sort((a, b) => scoreName(a[0]) - scoreName(b[0]) || a[0].length - b[0].length);
  if (hitPlace.length >= 1 && scoreName(hitPlace[0]![0]) <= 1) {
    const [name, pts] = hitPlace[0]!;
    const b = boundsOf(pts)!;
    const at: LonLat = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
    return { ok: true, name, at, bounds: b, match: "social-place" };
  }
  if (hitPlace.length === 1) {
    const [name, pts] = hitPlace[0]!;
    const b = boundsOf(pts)!;
    const at: LonLat = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
    return { ok: true, name, at, bounds: b, match: "social-place" };
  }

  const ents = (scene?.entities ?? [])
    .filter((e) => scoreName(e.name) < 9)
    .sort((a, b) => scoreName(a.name) - scoreName(b.name) || a.name.length - b.name.length);
  if (ents.length >= 1 && (ents.length === 1 || scoreName(ents[0]!.name) <= 1)) {
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

const kmBetween = (a: LonLat, b: LonLat) => Math.hypot((a[0] - b[0]) * 98.6, (a[1] - b[1]) * 110.6);
const KEY_HINT = "Street View needs VITE_GOOGLE_MAPS_API_KEY (Maps JavaScript API) in the repo-root .env, then a dev-server restart. It is not configured.";
export { KEY_HINT as STREET_VIEW_KEY_HINT };

/**
 * Road-closure picture at the current timeline stage, straight from the scene entities (names and coordinates come from data).
 * A closure is "closed now" when its stage <= the current stage (same rule the map filter uses). Optional `query` is a place
 * or hospital name: closures are then sorted by distance to it and hospital access is limited to matches.
 */
export function roadClosureReport(scene: SceneSnapshot | null, stage: number, query?: string, limit = 12) {
  const ents = scene?.entities ?? [];
  const closures = ents.filter((e) => e.kind === "closure");
  const closedNow = closures.filter((e) => (e.stage ?? 0) <= stage);
  const q = (query ?? "").trim();
  let origin: LonLat | null = null;
  let originName: string | null = null;
  let hospitals = ents.filter((e) => e.kind === "hospital");
  if (q) {
    const ql = q.toLowerCase();
    const hit = hospitals.filter((h) => h.name.toLowerCase().includes(ql));
    if (hit.length) { hospitals = hit; origin = hit[0]!.at; originName = hit[0]!.name; }
    else {
      const r = resolvePlace(scene, q);
      if (r.ok) { origin = r.at; originName = r.name; }
      else return { ok: false as const, error: `no place or hospital matching "${q}"`, suggestions: r.suggestions };
    }
  }
  const row = (e: Entity) => ({
    id: e.id, name: e.name, class: e.props.cls ?? null, bridge: !!e.props.bridge, lengthM: e.props.lengthM ?? null,
    lon: e.at[0], lat: e.at[1], ...(origin ? { distanceKm: +kmBetween(origin, e.at).toFixed(2) } : {}),
  });
  const sorted = origin ? [...closedNow].sort((a, b) => kmBetween(origin!, a.at) - kmBetween(origin!, b.at)) : closedNow;
  const pockets = stage >= 2 ? ents.filter((e) => e.kind === "pocket") : [];
  const pocketRows = (origin ? [...pockets].sort((a, b) => kmBetween(origin!, a.at) - kmBetween(origin!, b.at)) : pockets)
    .slice(0, 8).map((e) => ({ id: e.id, name: e.name, lon: e.at[0], lat: e.at[1], ...(origin ? { distanceKm: +kmBetween(origin, e.at).toFixed(2) } : {}) }));
  return {
    ok: true as const,
    stage,
    note: stage === 0 ? "Water is still low on the timeline: no roads are closed yet." : "Closed = stage <= current timeline stage. Minor closures and cut-off pockets only appear once the water is high (stage 2+).",
    nearOf: originName,
    closedCount: closedNow.length,
    totalPlanned: closures.length,
    closures: sorted.slice(0, limit).map(row),
    cutOffAreas: pocketRows,
    hospitalAccess: hospitals.map((h) => ({ id: h.id, name: h.name, access: h.props.access ?? "unknown", extraDelayMin: h.props.extraMin ?? 0, lon: h.at[0], lat: h.at[1] })),
    howToShow: "To fly the map to a closure or hospital call select_entity with its id; for a street-level look call open_street_view with that name.",
  };
}

const clip = (t: string, n = 320) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
export const postView = (p: Post) => ({
  id: p.id, when: whenLocal(p), outlet: p.outlet, place: p.places || p.district || null,
  tags: p.tags.split("; ").filter(Boolean).map((t) => TAG_LABEL[t] ?? t),
  text: clip(p.translation || p.excerpt), originalLang: p.translation ? p.lang ?? null : null, hasPhoto: !!p.image, url: p.url,
  onMap: (p.precision === "place" || p.precision === "town") && p.lon != null && p.lat != null,
  lon: p.lon, lat: p.lat,
});

/**
 * Search the real replayed social posts (newest first). Filters: free-text `query`, `tag` (label or key, fuzzy),
 * `near` (a place/entity name, posts within `radiusKm`), `photoOnly`. Everything returned is from data.
 */
export function searchSocialPosts(scene: SceneSnapshot | null, o: { query?: string; tag?: string; near?: string; photoOnly?: boolean; limit?: number; radiusKm?: number } = {}) {
  let pool = POSTS;
  let nearOf: string | null = null;
  if (o.near?.trim()) {
    const r = resolvePlace(scene, o.near);
    if (!r.ok) return { ok: false as const, error: `no place matching "${o.near}"`, suggestions: r.suggestions };
    nearOf = r.name;
    const radius = o.radiusKm ?? 1.5;
    pool = pool.filter((p) => p.lon != null && p.lat != null && (p.precision === "place" || p.precision === "town") && kmBetween(r.at, [p.lon, p.lat]) <= radius);
  }
  if (o.tag?.trim()) {
    const t = o.tag.trim().toLowerCase();
    const keys = Object.entries(TAG_LABEL).filter(([k, l]) => k.includes(t.replace(/\s+/g, "_")) || l.toLowerCase().includes(t)).map(([k]) => k);
    if (!keys.length) return { ok: false as const, error: `unknown tag "${o.tag}"`, tags: Object.values(TAG_LABEL) };
    pool = pool.filter((p) => keys.some((k) => p.tags.includes(k)));
  }
  if (o.query?.trim()) {
    const words = o.query.toLowerCase().split(/\s+/).filter(Boolean);
    pool = pool.filter((p) => { const h = `${p.excerpt} ${p.translation ?? ""} ${p.places} ${p.district}`.toLowerCase(); return words.every((w) => h.includes(w)); });
  }
  if (o.photoOnly) pool = pool.filter((p) => !!p.image);
  const limit = Math.max(1, Math.min(15, o.limit ?? 6));
  return { ok: true as const, nearOf, total: pool.length, shown: Math.min(limit, pool.length), posts: pool.slice(0, limit).map(postView), note: "Real Reddit posts replayed from 25 Sep to 3 Oct 2024; tags are keyword-based, unverified. Use open_social_post with an id (onMap=true) to show it." };
}

export function socialOverview() {
  const tags: Record<string, number> = {};
  for (const p of POSTS) for (const t of p.tags.split("; ").filter(Boolean)) tags[TAG_LABEL[t] ?? t] = (tags[TAG_LABEL[t] ?? t] ?? 0) + 1;
  return { total: POSTS.length, onMap: POSTS.filter((p) => (p.precision === "place" || p.precision === "town") && p.lon != null).length, withPhotos: POSTS.filter((p) => p.image).length, tags };
}

export type RadioStationLite = { id: string; name: string; tags: string[]; language: string; state: string; distKm: number | null; inValley: boolean; news: boolean; local: boolean; bitrate: number };
/** Live-broadcast directory search (Radio Browser). Local/valley and news stations first, then nearest. */
export function findRadioStations<T extends RadioStationLite>(stations: T[], o: { query?: string; localOnly?: boolean; newsOnly?: boolean; limit?: number } = {}) {
  const words = (o.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  let pool = stations.filter((st) => (!o.localOnly || st.inValley || st.local) && (!o.newsOnly || st.news));
  if (words.length) pool = pool.filter((st) => { const h = `${st.name} ${st.tags.join(" ")} ${st.language}`.toLowerCase(); return words.every((w) => h.includes(w)); });
  pool = [...pool].sort((a, b) => Number(b.inValley) - Number(a.inValley) || Number(b.news) - Number(a.news) || (a.distKm ?? 1e9) - (b.distKm ?? 1e9));
  const limit = Math.max(1, Math.min(15, o.limit ?? 8));
  return { total: pool.length, stations: pool.slice(0, limit).map((st) => ({ id: st.id, name: st.name, language: st.language, tags: st.tags.slice(0, 4), news: st.news, local: st.inValley || st.local, distKm: st.distKm, bitrate: st.bitrate })) };
}

/** Resolve a spoken station name ("BBC Nepali", "radio nepal", "khabar") to a station: exact > prefix > all-words match; valley/news first. */
export function resolveRadioStation<T extends RadioStationLite>(stations: T[], name: string): { station: T | null; alternatives: string[] } {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9\u0900-\u097f ]+/g, " ").replace(/\s+/g, " ").trim();
  const q = norm(name);
  if (!q) return { station: null, alternatives: [] };
  const words = q.split(" ");
  const score = (st: T) => {
    const n = norm(st.name);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return words.every((w) => n.includes(w)) ? 3 : 9;
  };
  const hits = stations.filter((st) => score(st) < 9).sort((a, b) => score(a) - score(b) || Number(b.inValley) - Number(a.inValley) || Number(b.news) - Number(a.news) || a.name.length - b.name.length);
  return { station: hits[0] ?? null, alternatives: hits.slice(1, 5).map((h) => h.name) };
}
