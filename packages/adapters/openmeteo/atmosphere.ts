/**
 * Kathmandu atmosphere overlay: cloud_cover + pressure_msl from Open-Meteo,
 * disk-cached under data/cache/weather/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AtmospherePort, AtmosphereSnapshot, FeatureCollection } from "../../ports/index.ts";
import { KTM_BBOX } from "../osm/assets.ts";
import { buildAtmosphereLayers, type AtmGrid } from "./atmosphereGrid.ts";

const DEFAULT_CACHE = fileURLToPath(new URL("../../../data/cache/weather/atmosphere-ktm-v2.json", import.meta.url));
const UA = "CascadeIQ/0.1 (hackathon; contact: local-dev)";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function emptySnap(partial: Partial<AtmosphereSnapshot> & Pick<AtmosphereSnapshot, "source">): AtmosphereSnapshot {
  return {
    bbox: KTM_BBOX,
    fetchedAt: new Date().toISOString(),
    validAt: new Date().toISOString(),
    licence: "Open-Meteo (non-commercial free tier) · illustrative contours",
    cacheHit: false,
    clouds: EMPTY,
    isobars: EMPTY,
    centers: EMPTY,
    extensions: {},
    ...partial,
  };
}

function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

export function valleySamplePoints(
  bbox: [number, number, number, number] = KTM_BBOX,
  step = 0.02,
): { lons: number[]; lats: number[]; pairs: [number, number][] } {
  const [west, south, east, north] = bbox;
  const nLon = Math.max(2, Math.round((east - west) / step) + 1);
  const nLat = Math.max(2, Math.round((north - south) / step) + 1);
  const lons = linspace(west, east, nLon);
  const lats = linspace(south, north, nLat);
  const pairs: [number, number][] = [];
  for (const lat of lats) for (const lon of lons) pairs.push([lon, lat]);
  return { lons, lats, pairs };
}

/** Deterministic fixture grid for offline / WEATHER_ADAPTER=fixture. */
export function fixtureAtmosphereGrid(bbox: [number, number, number, number] = KTM_BBOX): AtmGrid {
  const { lons, lats } = valleySamplePoints(bbox, 0.04);
  const pressure = lats.map((lat, j) =>
    lons.map((lon, i) => 1012 + Math.sin(i * 0.7) * 3 + Math.cos(j * 0.9) * 2 - (lat - 27.7) * 8));
  const cloud = lats.map((lat, j) =>
    lons.map((lon, i) => Math.max(0, Math.min(100, 55 + Math.sin(i + j) * 35 + (lon - 85.35) * 80))));
  return { lons, lats, pressure, cloud };
}

export class FixtureAtmosphereAdapter implements AtmospherePort {
  constructor(private bbox: [number, number, number, number] = KTM_BBOX) {}
  async load(): Promise<AtmosphereSnapshot> {
    const layers = buildAtmosphereLayers(fixtureAtmosphereGrid(this.bbox));
    return emptySnap({
      bbox: this.bbox,
      source: "fixture",
      cacheHit: true,
      ...layers,
    });
  }
}

type OmHourly = { time?: string[]; cloud_cover?: (number | null)[]; pressure_msl?: (number | null)[] };
type OmLoc = { latitude: number; longitude: number; hourly?: OmHourly };

export class OpenMeteoAtmosphereAdapter implements AtmospherePort {
  constructor(
    private opts: {
      bbox?: [number, number, number, number];
      cachePath?: string;
      fetchImpl?: typeof fetch;
      maxAgeMs?: number;
      step?: number;
    } = {},
  ) {}

  private get bbox() { return this.opts.bbox ?? KTM_BBOX; }
  private get cachePath() { return this.opts.cachePath ?? DEFAULT_CACHE; }
  private get fetchImpl() { return this.opts.fetchImpl ?? globalThis.fetch.bind(globalThis); }
  private get maxAgeMs() { return this.opts.maxAgeMs ?? 60 * 60 * 1000; }
  private get step() { return this.opts.step ?? 0.02; }

  async load(opts?: { refresh?: boolean }): Promise<AtmosphereSnapshot> {
    if (!opts?.refresh) {
      const cached = this.readCache();
      if (cached) return { ...cached, cacheHit: true };
    }
    try {
      const snap = await this.fetchLive();
      this.writeCache(snap);
      return { ...snap, cacheHit: false };
    } catch {
      const stale = this.readCache(true);
      if (stale) return { ...stale, cacheHit: true, source: `${stale.source}+stale-fallback` };
      return emptySnap({ source: "unavailable", cacheHit: false });
    }
  }

  private readCache(ignoreAge = false): AtmosphereSnapshot | null {
    if (!existsSync(this.cachePath)) return null;
    try {
      const raw = JSON.parse(readFileSync(this.cachePath, "utf8")) as AtmosphereSnapshot;
      if (!ignoreAge && raw.fetchedAt) {
        const age = Date.now() - Date.parse(raw.fetchedAt);
        if (age > this.maxAgeMs) return null;
      }
      return raw;
    } catch {
      return null;
    }
  }

  private writeCache(snap: AtmosphereSnapshot) {
    mkdirSync(dirname(this.cachePath), { recursive: true });
    writeFileSync(this.cachePath, JSON.stringify(snap));
  }

  private async fetchLive(): Promise<AtmosphereSnapshot> {
    const { lons, lats, pairs } = valleySamplePoints(this.bbox, this.step);
    const chunk = 40;
    const cells: { lon: number; lat: number; cloud: number; pressure: number; time: string }[] = [];
    for (let c = 0; c < pairs.length; c += chunk) {
      const slice = pairs.slice(c, c + chunk);
      const lat = slice.map((p) => p[1]).join(",");
      const lon = slice.map((p) => p[0]).join(",");
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=cloud_cover,pressure_msl&forecast_hours=1&timezone=auto`;
      const res = await this.fetchImpl(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`open-meteo atmosphere ${res.status}`);
      const data = await res.json() as OmLoc | OmLoc[];
      const list = Array.isArray(data) ? data : [data];
      list.forEach((loc, idx) => {
        const [plon, plat] = slice[idx] ?? [loc.longitude, loc.latitude];
        const t = loc.hourly?.time?.[0] ?? new Date().toISOString();
        const cloud = loc.hourly?.cloud_cover?.[0];
        const pressure = loc.hourly?.pressure_msl?.[0];
        if (cloud == null || pressure == null) return;
        cells.push({ lon: plon, lat: plat, cloud, pressure, time: t });
      });
    }
    if (!cells.length) throw new Error("open-meteo atmosphere empty");

    const pressure: number[][] = lats.map(() => lons.map(() => NaN));
    const cloud: number[][] = lats.map(() => lons.map(() => NaN));
    const lonIx = new Map(lons.map((v, i) => [v.toFixed(5), i]));
    const latIx = new Map(lats.map((v, i) => [v.toFixed(5), i]));
    for (const cell of cells) {
      // Match nearest grid axis (float noise from API).
      let i = lonIx.get(cell.lon.toFixed(5));
      let j = latIx.get(cell.lat.toFixed(5));
      if (i == null) i = lons.reduce((bi, lon, k) => Math.abs(lon - cell.lon) < Math.abs(lons[bi]! - cell.lon) ? k : bi, 0);
      if (j == null) j = lats.reduce((bj, lat, k) => Math.abs(lat - cell.lat) < Math.abs(lats[bj]! - cell.lat) ? k : bj, 0);
      pressure[j]![i] = cell.pressure;
      cloud[j]![i] = cell.cloud;
    }
    // Fill any holes from nearest neighbour.
    for (let j = 0; j < lats.length; j++) {
      for (let i = 0; i < lons.length; i++) {
        if (Number.isFinite(pressure[j]![i])) continue;
        let best = Infinity, bp = 1013, bc = 50;
        for (const cell of cells) {
          const d = Math.hypot(cell.lon - lons[i]!, cell.lat - lats[j]!);
          if (d < best) { best = d; bp = cell.pressure; bc = cell.cloud; }
        }
        pressure[j]![i] = bp;
        cloud[j]![i] = bc;
      }
    }

    const layers = buildAtmosphereLayers({ lons, lats, pressure, cloud });
    return emptySnap({
      bbox: this.bbox,
      validAt: cells[0]!.time,
      source: "open-meteo-forecast",
      ...layers,
    });
  }
}
