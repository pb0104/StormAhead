/**
 * REAL social posts for the console, built by scripts/social_signals.py into data/social/<area>/feed.json.
 * Source: Reddit (r/Nepal, r/Kathmandu) via the Arctic Shift archive, 25 Sep to 3 Oct 2024, kept only when they mention
 * the flood. Places come from matching names against GeoNames; tags are a keyword baseline on HumAID's categories.
 * Replayed for the demo: these are past posts shown as if they were arriving.
 */
import raw from "../../../../data/social/kathmandu-2024-09/feed.json";
import type { Entity } from "../../../../packages/ports/index.ts";

export type Post = {
  id: string; source: string; time_utc: string; hour_local: string; outlet: string; url: string; excerpt: string;
  places: string; district: string; lon: number | null; lat: number | null; image: string; tags: string;
  precision: "place" | "town" | "district" | "none";
  /** Language as the translator named it, its English translation (empty for English posts or when not translated),
   * and which model translated it. The original text is always kept in `excerpt`. */
  lang?: string; translation?: string; translator?: string;
};

export const SOCIAL_SOURCE = "Reddit (r/Nepal, r/Kathmandu) via the Arctic Shift archive, 25 Sep to 3 Oct 2024. Only posts that mention the flood.";
export const NEAR_KM = 1.5;

export const POSTS: Post[] = (raw as Omit<Post, "id">[])
  .map((p, i) => ({ ...p, id: `SP-${i + 1}` }))
  .sort((a, b) => b.time_utc.localeCompare(a.time_utc)); // newest first, like a live feed

const km = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 98.6, (a[1] - b[1]) * 110.6);
/** A post is "at a spot" only when it names a specific place or town. District-wide mentions never count as local. */
const local = (p: Post) => (p.precision === "place" || p.precision === "town") && p.lon !== null && p.lat !== null;

export const postsNear = (at: [number, number], radiusKm = NEAR_KM) =>
  POSTS.filter((p) => local(p) && km(at, [p.lon!, p.lat!]) <= radiusKm);
/** Posts about the flood that name no place more precise than a district: shown as "across the valley". */
export const AREA_POSTS = POSTS.filter((p) => !local(p));

export const whenLocal = (p: Post) => {
  const d = new Date(`${p.hour_local}:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) + `, ${p.hour_local.slice(11, 16)}`;
};
export const TAG_LABEL: Record<string, string> = {
  infrastructure_and_utility_damage: "Damage", injured_or_dead_people: "Injured or dead", missing_or_found_people: "Missing or found",
  displaced_people_and_evacuations: "Evacuation", requests_or_urgent_needs: "Urgent need", rescue_volunteering_or_donation_effort: "Rescue or donation",
  caution_and_advice: "Warning or advice", sympathy_and_support: "Sympathy",
};

/** Posts with a specific place become map points, replacing the simulated social posts. */
export const SOCIAL_ENTITIES: Entity[] = POSTS.filter(local).map((p) => ({
  kind: "social", id: p.id, name: p.excerpt.length > 70 ? p.excerpt.slice(0, 67) + "…" : p.excerpt, at: [p.lon!, p.lat!],
  geom: { type: "Point", coordinates: [p.lon!, p.lat!] },
  props: { text: p.excerpt, when: whenLocal(p), url: p.url, image: p.image, tags: p.tags, outlet: p.outlet, places: p.places, prov: "post", lang: p.lang ?? "", translation: p.translation ?? "", translator: p.translator ?? "" },
}));
