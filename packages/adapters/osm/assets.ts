/**
 * Critical-asset adapter: hospitals, schools, dams, airports, towers, shelters
 * from OpenStreetMap via Overpass, disk-cached under data/cache/osm/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AssetKind, AssetsPort, AssetsSnapshot, Geometry, OsmAsset, ScenePort,
} from "../../ports/index.ts";

/** Kathmandu valley box (same as hindcast / console). */
export const KTM_BBOX: [number, number, number, number] = [85.284, 27.587, 85.493, 27.788];
const DEFAULT_CACHE = fileURLToPath(new URL("../../../data/cache/osm/assets-ktm-v4.json", import.meta.url));
const OVERPASS = "https://overpass-api.de/api/interpreter";
const UA = "CascadeIQ/0.1 (hackathon; contact: local-dev)";

type OverpassEl = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function classify(tags: Record<string, string>): AssetKind | null {
  const a = tags.amenity, w = tags.waterway, m = tags.man_made, ae = tags.aeroway, e = tags.emergency, tt = tags["tower:type"];
  if (a === "hospital" || a === "clinic") return "hospital";
  if (a === "school" || a === "college" || a === "university" || a === "kindergarten") return "school";
  if (w === "dam" || m === "dam") return "dam";
  if (ae === "aerodrome") return "airport";
  if (ae === "helipad") return "helipad";
  if (a === "shelter" || e === "assembly_point") return "shelter";
  if (m === "mast" || (m === "tower" && (tt === "communication" || tt === "cellular" || !tt))) return "tower";
  return null;
}

function nameOf(tags: Record<string, string>, kind: AssetKind, id: number): string {
  const named =
    tags.name?.trim() ||
    tags["name:en"]?.trim() ||
    tags["name:ne"]?.trim() ||
    tags.alt_name?.trim() ||
    tags.loc_name?.trim() ||
    tags.official_name?.trim() ||
    tags.operator?.trim();
  if (named) return named;
  // Prefer a readable label over "dam 12345" when OSM has no name tag.
  const kindLabel: Record<AssetKind, string> = {
    hospital: "Hospital", school: "School", dam: "Dam", airport: "Airport", helipad: "Helipad", tower: "Cell tower", shelter: "Shelter",
  };
  return `Unnamed ${kindLabel[kind]} (OSM ${id})`;
}

function point(el: OverpassEl): [number, number] | null {
  if (el.lat != null && el.lon != null) return [el.lon, el.lat];
  if (el.center) return [el.center.lon, el.center.lat];
  return null;
}

function buildQuery(bbox: [number, number, number, number]): string {
  const [west, south, east, north] = bbox;
  const b = `${south},${west},${north},${east}`;
  return `
[out:json][timeout:90];
(
  nwr["amenity"="hospital"](${b});
  nwr["amenity"="clinic"](${b});
  nwr["amenity"="school"](${b});
  nwr["amenity"="college"](${b});
  nwr["amenity"="university"](${b});
  nwr["waterway"="dam"](${b});
  nwr["man_made"="dam"](${b});
  nwr["aeroway"="aerodrome"](${b});
  nwr["aeroway"="helipad"](${b});
  nwr["amenity"="shelter"](${b});
  nwr["emergency"="assembly_point"](${b});
  nwr["man_made"="mast"](${b});
  nwr["man_made"="tower"]["tower:type"="communication"](${b});
  nwr["man_made"="tower"]["tower:type"="cellular"](${b});
  // Named water for dam labels (not shown as assets).
  nwr["natural"="water"]["name"](${b});
  nwr["landuse"="reservoir"]["name"](${b});
  nwr["water"="reservoir"]["name"](${b});
  nwr["water"="pond"]["name"](${b});
);
out center tags;
`.trim();
}

function isNamedWater(tags: Record<string, string>): boolean {
  if (!tags.name?.trim()) return false;
  return tags.natural === "water" || tags.landuse === "reservoir"
    || tags.water === "reservoir" || tags.water === "pond" || tags.water === "lake";
}

/** Attach a local waterbody name to unnamed OSM dams (e.g. Muhan Pokhari dam). */
export function enrichDamNames(assets: OsmAsset[], elements: OverpassEl[]): OsmAsset[] {
  const waters = elements
    .map((el) => {
      const tags = el.tags ?? {};
      if (!isNamedWater(tags)) return null;
      const at = point(el);
      if (!at) return null;
      return { name: tags.name!.trim(), at };
    })
    .filter((w): w is { name: string; at: [number, number] } => !!w);

  return assets.map((a) => {
    if (a.kind !== "dam") return a;
    if (a.tags.name || a.tags["name:en"] || a.tags["name:ne"]) return a;
    let best: { name: string; at: [number, number] } | null = null;
    let bestKm = 0.45;
    for (const w of waters) {
      const km = Math.hypot((a.at[0] - w.at[0]) * 98.6, (a.at[1] - w.at[1]) * 110.6);
      if (km < bestKm) { bestKm = km; best = w; }
    }
    if (!best) return a;
    const name = /dam|बाँध|reservoir/i.test(best.name) ? best.name : `${best.name} dam`;
    return { ...a, name, tags: { ...a.tags, derived_name: best.name } };
  });
}

function toAsset(el: OverpassEl): OsmAsset | null {
  const tags = el.tags ?? {};
  const kind = classify(tags);
  if (!kind) return null;
  const at = point(el);
  if (!at) return null;
  const geom: Geometry = { type: "Point", coordinates: at };
  return {
    id: `osm/${el.type}/${el.id}`,
    kind,
    name: nameOf(tags, kind, el.id),
    at,
    geom,
    tags,
    osmType: el.type,
    osmId: el.id,
  };
}

function counts(assets: OsmAsset[]): AssetsSnapshot["counts"] {
  const c: AssetsSnapshot["counts"] = {};
  for (const a of assets) c[a.kind] = (c[a.kind] ?? 0) + 1;
  return c;
}

const ALWAYS_KEEP: AssetKind[] = ["dam", "airport", "helipad", "tower"];
const NAMED_CAP: Partial<Record<AssetKind, number>> = { hospital: 120, school: 120, shelter: 80 };

/** Prefer named sites; always keep every dam/airport/helipad/tower so labels stay real. */
export function prioritizeAssets(assets: OsmAsset[]): OsmAsset[] {
  const out: OsmAsset[] = [];
  const used = new Set<string>();
  for (const kind of ALWAYS_KEEP) {
    for (const a of assets) {
      if (a.kind !== kind || used.has(a.id)) continue;
      used.add(a.id);
      out.push(a);
    }
  }
  for (const [kind, cap] of Object.entries(NAMED_CAP) as [AssetKind, number][]) {
    const named = assets.filter((a) => a.kind === kind && !used.has(a.id) && a.tags.name);
    const unnamed = assets.filter((a) => a.kind === kind && !used.has(a.id) && !a.tags.name);
    for (const a of [...named, ...unnamed].slice(0, cap)) {
      used.add(a.id);
      out.push(a);
    }
  }
  return out;
}

/** Offline: project OSM scene entities into the assets shape. */
export class FixtureAssetsAdapter implements AssetsPort {
  constructor(private scene: ScenePort) {}

  async load(): Promise<AssetsSnapshot> {
    const s = this.scene.load();
    const kinds = new Set<AssetKind>(["hospital", "school", "dam", "airport", "helipad", "tower", "shelter"]);
    const assets: OsmAsset[] = s.entities
      .filter((e) => kinds.has(e.kind as AssetKind))
      .map((e, i) => ({
        id: `osm/${e.id}`,
        kind: e.kind as AssetKind,
        name: e.name,
        at: e.at,
        geom: e.geom.type === "Point" ? e.geom : { type: "Point" as const, coordinates: e.at },
        tags: Object.fromEntries(Object.entries(e.props).map(([k, v]) => [k, String(v)])),
        osmType: "node" as const,
        osmId: i + 1,
      }));
    return {
      bbox: s.bbox,
      fetchedAt: new Date().toISOString(),
      source: "osm-scene",
      licence: "ODbL © OpenStreetMap contributors",
      cacheHit: true,
      counts: counts(assets),
      assets,
    };
  }
}

export class OverpassAssetsAdapter implements AssetsPort {
  constructor(
    private opts: {
      bbox?: [number, number, number, number];
      cachePath?: string;
      fetchImpl?: typeof fetch;
      /** Max age of disk cache before auto-refresh (ms). Default 24h. */
      maxAgeMs?: number;
    } = {},
  ) {}

  private get bbox() { return this.opts.bbox ?? KTM_BBOX; }
  private get cachePath() { return this.opts.cachePath ?? DEFAULT_CACHE; }
  private get fetchImpl() { return this.opts.fetchImpl ?? globalThis.fetch.bind(globalThis); }
  private get maxAgeMs() { return this.opts.maxAgeMs ?? 24 * 60 * 60 * 1000; }

  async load(opts?: { refresh?: boolean }): Promise<AssetsSnapshot> {
    if (!opts?.refresh) {
      const cached = this.readCache();
      if (cached) return this.present(cached, true);
    }
    try {
      const raw = await this.fetchOverpass();
      const snap: AssetsSnapshot = {
        bbox: this.bbox,
        fetchedAt: new Date().toISOString(),
        source: "openstreetmap-overpass",
        licence: "ODbL © OpenStreetMap contributors",
        cacheHit: false,
        counts: counts(raw),
        assets: raw,
      };
      this.writeCache(snap);
      return this.present(snap, false);
    } catch (e) {
      const cached = this.readCache(true);
      if (cached) {
        return this.present(
          { ...cached, source: `${cached.source}+stale-fallback` },
          true,
        );
      }
      throw e;
    }
  }

  private present(snap: AssetsSnapshot, cacheHit: boolean): AssetsSnapshot {
    const assets = prioritizeAssets(snap.assets);
    return { ...snap, cacheHit, assets, counts: counts(assets) };
  }

  private readCache(ignoreAge = false): AssetsSnapshot | null {
    if (!existsSync(this.cachePath)) return null;
    try {
      const raw = JSON.parse(readFileSync(this.cachePath, "utf8")) as AssetsSnapshot & { savedAt?: string };
      if (!ignoreAge && raw.fetchedAt) {
        const age = Date.now() - Date.parse(raw.fetchedAt);
        if (age > this.maxAgeMs) return null;
      }
      return raw;
    } catch {
      return null;
    }
  }

  private writeCache(snap: AssetsSnapshot) {
    mkdirSync(dirname(this.cachePath), { recursive: true });
    writeFileSync(this.cachePath, JSON.stringify(snap));
  }

  private async fetchOverpass(): Promise<OsmAsset[]> {
    const body = buildQuery(this.bbox);
    const res = await this.fetchImpl(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
      body: `data=${encodeURIComponent(body)}`,
    });
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    const data = await res.json() as { elements?: OverpassEl[] };
    const elements = data.elements ?? [];
    const seen = new Set<string>();
    const out: OsmAsset[] = [];
    for (const el of elements) {
      const a = toAsset(el);
      if (!a || seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
    return enrichDamNames(out, elements);
  }
}

/** Cache path helper for tests. */
export const osmAssetsCachePath = (...parts: string[]) => join(...parts);
