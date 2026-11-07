/**
 * Two demo agents that give the flood water a depth.
 *  - Weather agent (MOCK): turns a rainfall forecast, in inches over 24 h, into a total, a range and a peak intensity.
 *  - Terrain agent (REAL elevation): reads public elevation tiles and ranks each observed flood patch by how low it sits
 *    (flood-edge ground height minus the low ground inside it). The absolute depth scale is an assumption.
 * Depth model (ILLUSTRATIVE, not a hydraulic simulation): depth scales linearly with rain, relative to a 10 in reference, and
 * patches shallower than 0.1 m are shown dry. It can only show LESS water than the observed extent, or deeper water in it,
 * never a larger area.
 */
import { BBOX, FLOOD_POLYS } from "./mock/demo.ts";
import type { Grid } from "./hydro.ts";

export type Weather = { inches: number; mm: number; lowIn: number; highIn: number; peakMmH: number; label: string };
export const STAGE_FRACTION: Record<number, number> = { 1: 0.4, 2: 0.75, 3: 1 };

export function weatherAgent(inches: number): Weather {
  const mm = inches * 25.4;
  return {
    inches, mm, lowIn: Math.max(0, Math.round(inches * 0.8 * 10) / 10), highIn: Math.round(inches * 1.2 * 10) / 10,
    peakMmH: Math.round((mm / 24) * 2.6),
    label: inches >= 14 ? "Extreme" : inches >= 9 ? "Heavy" : inches >= 5 ? "Moderate" : "Light",
  };
}

export type Terrain = { status: "idle" | "loading" | "ready" | "fallback"; depth0: number[]; medianDepth: number; note: string; grid?: Grid };
export const TERRAIN_IDLE: Terrain = { status: "idle", depth0: [], medianDepth: 0, note: "Terrain agent has not run yet." };
/** The 10 in reference: the depth the terrain agent measures is treated as the depth at 10 in of rain (an assumption). */
export const REF_INCHES = 10, DRY_BELOW_M = 0.2, MAX_DEPTH_AT_REF = 2.4;

const Z = 13, N = 2 ** Z;
const tx = (lon: number) => ((lon + 180) / 360) * N;
const ty = (lat: number) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N; };
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))] ?? 0; };
const inside = (x: number, y: number, ring: [number, number][]) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

async function loadTile(x: number, y: number): Promise<Float32Array> {
  const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`);
  if (!res.ok) throw new Error(`terrain tile ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, 256, 256).data, out = new Float32Array(256 * 256);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4]! * 256 + px[i * 4 + 1]! + px[i * 4 + 2]! / 256 - 32768;
  return out;
}

let cache: Promise<Terrain> | null = null;
/**
 * Depth at the observed peak, per patch: the water surface is taken as the ground height along the flood edge (where water
 * meets land, depth is about zero), and depth is that surface minus the low ground inside the patch.
 */
export function terrainAgent(): Promise<Terrain> {
  return (cache ??= (async (): Promise<Terrain> => {
    const lons = [...FLOOD_POLYS.flatMap((f) => f.ring.map((c) => c[0])), BBOX[0], BBOX[2]], lats = [...FLOOD_POLYS.flatMap((f) => f.ring.map((c) => c[1])), BBOX[1], BBOX[3]];
    const x0 = Math.floor(tx(Math.min(...lons) - 0.01)), x1 = Math.floor(tx(Math.max(...lons) + 0.01));
    const y0 = Math.floor(ty(Math.max(...lats) + 0.01)), y1 = Math.floor(ty(Math.min(...lats) - 0.01));
    try {
      const tiles = new Map<string, Float32Array>(), w = x1 - x0 + 1;
      await Promise.all(Array.from({ length: w * (y1 - y0 + 1) }, (_, i) => {
        const x = x0 + (i % w), y = y0 + Math.floor(i / w);
        return loadTile(x, y).then((t) => tiles.set(`${x}/${y}`, t));
      }));
      const elev = (lon: number, lat: number) => {
        const fx = tx(lon), fy = ty(lat), x = Math.floor(fx), y = Math.floor(fy), t = tiles.get(`${x}/${y}`);
        return t ? t[Math.min(255, Math.floor((fy - y) * 256)) * 256 + Math.min(255, Math.floor((fx - x) * 256))]! : undefined;
      };
      const depth0 = FLOOD_POLYS.map((f) => {
        const edge = f.ring.map((c) => elev(c[0], c[1])).filter((v): v is number => v !== undefined);
        if (!edge.length) return NaN;
        const xs = f.ring.map((c) => c[0]), ys = f.ring.map((c) => c[1]);
        const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
        const inner: number[] = [];
        for (let i = 0; i <= 14; i++) for (let j = 0; j <= 14; j++) {
          const lon = minx + ((maxx - minx) * i) / 14, lat = miny + ((maxy - miny) * j) / 14;
          if (inside(lon, lat, f.ring)) { const v = elev(lon, lat); if (v !== undefined) inner.push(v); }
        }
        const surface = pct(edge, 0.6), low = inner.length ? pct(inner, 0.2) : pct(edge, 0.05);
        return Math.min(8, Math.max(0, surface - low));
      });
      const ok = depth0.filter((d) => Number.isFinite(d));
      if (ok.length < FLOOD_POLYS.length * 0.6) throw new Error("too few elevation samples");
      const med = pct(ok, 0.5), raw = depth0.map((d) => (Number.isFinite(d) ? d : med));
      // 30 m elevation tiles are noisy over narrow river patches, so use them for the ORDER of depths (which patches are lowest)
      // and set the absolute scale by assumption: up to 2.4 m at the 10 in reference.
      const order = raw.map((d, i) => i).sort((a, b) => raw[a]! - raw[b]! || FLOOD_POLYS[b]!.r - FLOOD_POLYS[a]!.r);
      const q = new Array<number>(raw.length); order.forEach((idx, rank) => { q[idx] = rank / (raw.length - 1); });
      const clean = q.map((v) => MAX_DEPTH_AT_REF * Math.pow(v, 1.6));
      // 70 m elevation grid over the valley for the flow agent.
      const cellM = 70, gw = Math.round(((BBOX[2] - BBOX[0]) * 98600) / cellM), gh = Math.round(((BBOX[3] - BBOX[1]) * 110600) / cellM), z = new Float32Array(gw * gh);
      for (let yy = 0; yy < gh; yy++) for (let xx = 0; xx < gw; xx++) z[yy * gw + xx] = elev(BBOX[0] + ((xx + 0.5) / gw) * (BBOX[2] - BBOX[0]), BBOX[3] - ((yy + 0.5) / gh) * (BBOX[3] - BBOX[1])) ?? 1300;
      const grid: Grid = { w: gw, h: gh, lon0: BBOX[0], lon1: BBOX[2], lat0: BBOX[1], lat1: BBOX[3], cellM, z };
      return { status: "ready", grid, depth0: clean, medianDepth: pct(clean, 0.5), note: `Read ${tiles.size} elevation tiles and ranked ${clean.length} flood patches by how low they sit. At 10 in of rain the deepest patch holds about ${MAX_DEPTH_AT_REF} m and the median about ${pct(clean, 0.5).toFixed(1)} m.` };
    } catch (e) {
      // Offline or tiles blocked: use a default so the console still works, and say so.
      const depth0 = FLOOD_POLYS.map((f) => MAX_DEPTH_AT_REF * Math.pow(1 - f.r, 1.6));
      return { status: "fallback", depth0, medianDepth: pct(depth0, 0.5), note: `Elevation tiles unavailable (${(e as Error).message}). Using a default depth guess from patch size.` };
    }
  })());
}

/** Depth in metres per flood patch (FLOOD_POLYS order): the measured depth scaled by rain relative to the 10 in reference, and by how much has fallen so far. */
export function floodDepths(t: Terrain, inches: number, frac: number): number[] {
  if (!t.depth0.length) return FLOOD_POLYS.map(() => 0);
  const s = (inches * frac) / REF_INCHES;
  return t.depth0.map((d) => { const v = d * s; return v < DRY_BELOW_M ? 0 : v; });
}
