import { PNG } from "pngjs";
import type { Grid, TerrainPort, TerrainResult, TileCachePort } from "../../ports/index.ts";
import { FLOOD_POLYS, BBOX } from "../fixture/scene.ts";

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

function decodeTerrarium(pngBuf: Buffer): Float32Array {
  const png = PNG.sync.read(pngBuf);
  const out = new Float32Array(256 * 256);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    out[i] = png.data[o]! * 256 + png.data[o + 1]! + png.data[o + 2]! / 256 - 32768;
  }
  return out;
}

export class TerrariumTerrainAdapter implements TerrainPort {
  private cache: Promise<TerrainResult> | null = null;

  constructor(private tiles: TileCachePort) {}

  assess(): Promise<TerrainResult> {
    return (this.cache ??= this.run());
  }

  private async run(): Promise<TerrainResult> {
    const lons = [...FLOOD_POLYS.flatMap((f) => f.ring.map((c) => c[0])), BBOX[0], BBOX[2]];
    const lats = [...FLOOD_POLYS.flatMap((f) => f.ring.map((c) => c[1])), BBOX[1], BBOX[3]];
    const x0 = Math.floor(tx(Math.min(...lons) - 0.01)), x1 = Math.floor(tx(Math.max(...lons) + 0.01));
    const y0 = Math.floor(ty(Math.max(...lats) + 0.01)), y1 = Math.floor(ty(Math.min(...lats) - 0.01));
    try {
      const elevTiles = new Map<string, Float32Array>(), w = x1 - x0 + 1;
      await Promise.all(Array.from({ length: w * (y1 - y0 + 1) }, async (_, i) => {
        const x = x0 + (i % w), y = y0 + Math.floor(i / w);
        const { body } = await this.tiles.getTerrarium(Z, x, y);
        elevTiles.set(`${x}/${y}`, decodeTerrarium(body));
      }));
      const elev = (lon: number, lat: number) => {
        const fx = tx(lon), fy = ty(lat), x = Math.floor(fx), y = Math.floor(fy), t = elevTiles.get(`${x}/${y}`);
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
      const order = raw.map((d, i) => i).sort((a, b) => raw[a]! - raw[b]! || FLOOD_POLYS[b]!.r - FLOOD_POLYS[a]!.r);
      const q = new Array<number>(raw.length); order.forEach((idx, rank) => { q[idx] = rank / (raw.length - 1); });
      const clean = q.map((v) => MAX_DEPTH_AT_REF * Math.pow(v, 1.6));
      const cellM = 70, gw = Math.round(((BBOX[2] - BBOX[0]) * 98600) / cellM), gh = Math.round(((BBOX[3] - BBOX[1]) * 110600) / cellM);
      const z = new Float32Array(gw * gh);
      for (let yy = 0; yy < gh; yy++) for (let xx = 0; xx < gw; xx++) {
        z[yy * gw + xx] = elev(BBOX[0] + ((xx + 0.5) / gw) * (BBOX[2] - BBOX[0]), BBOX[3] - ((yy + 0.5) / gh) * (BBOX[3] - BBOX[1])) ?? 1300;
      }
      const grid: Grid = { w: gw, h: gh, lon0: BBOX[0], lon1: BBOX[2], lat0: BBOX[1], lat1: BBOX[3], cellM, z: Array.from(z) };
      return {
        status: "ready", grid, depth0: clean, medianDepth: pct(clean, 0.5),
        note: `Read ${elevTiles.size} elevation tiles and ranked ${clean.length} flood patches by how low they sit. At 10 in of rain the deepest patch holds about ${MAX_DEPTH_AT_REF} m and the median about ${pct(clean, 0.5).toFixed(1)} m.`,
      };
    } catch (e) {
      const depth0 = FLOOD_POLYS.map((f) => MAX_DEPTH_AT_REF * Math.pow(1 - f.r, 1.6));
      return { status: "fallback", depth0, medianDepth: pct(depth0, 0.5), note: `Elevation tiles unavailable (${(e as Error).message}). Using a default depth guess from patch size.` };
    }
  }
}
