import { PNG } from "pngjs";
import type { FeatureCollection, FloodPoly, FlowPort, Grid } from "../../ports/index.ts";
import { DRY_BELOW_M, REF_INCHES } from "../terrarium/index.ts";

export const RUNOFF_COEF = 0.7, SHOW_ABOVE_M = 0.25, STEPS = 220;
const NB: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function asFloat(z: number[] | Float32Array) {
  return z instanceof Float32Array ? z : Float32Array.from(z);
}

export function flowAccumulation(g: Grid): Float32Array {
  const z = asFloat(g.z), n = g.w * g.h, acc = new Float32Array(n).fill(1);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => z[b]! - z[a]!);
  for (const i of order) {
    const x = i % g.w, y = (i - x) / g.w;
    if (x < 1 || y < 1 || x > g.w - 2 || y > g.h - 2) continue;
    let best = -1, bz = z[i]!;
    for (const [dx, dy] of NB) { const j = i + dy * g.w + dx; if (z[j]! < bz) { bz = z[j]!; best = j; } }
    if (best >= 0) acc[best]! += acc[i]!;
  }
  return acc;
}

export function slopeField(g: Grid) {
  const z = asFloat(g.z), gx = new Float32Array(g.w * g.h), gy = new Float32Array(g.w * g.h);
  for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
    const i = y * g.w + x;
    gx[i] = (z[i + 1]! - z[i - 1]!) / (2 * g.cellM);
    gy[i] = (z[i + g.w]! - z[i - g.w]!) / (2 * g.cellM);
  }
  return { gx, gy, acc: flowAccumulation(g) };
}

export function runoffSync(g: Grid, mmRain: number, field: { gx: Float32Array; gy: Float32Array }) {
  const z = asFloat(g.z), n = g.w * g.h, w = new Float32Array(n).fill((mmRain / 1000) * RUNOFF_COEF), delta = new Float32Array(n);
  for (let step = 0; step < STEPS; step++) {
    delta.fill(0);
    for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
      const i = y * g.w + x, wi = w[i]!;
      if (wi < 1e-4) continue;
      const hi = z[i]! + wi;
      let best = -1, bh = hi;
      for (const [dx, dy] of NB) { const j = i + dy * g.w + dx, hj = z[j]! + w[j]!; if (hj < bh) { bh = hj; best = j; } }
      if (best >= 0) { const amt = Math.min(wi, (hi - bh) * 0.6); delta[i]! -= amt; delta[best]! += amt; }
    }
    for (let i = 0; i < n; i++) w[i]! += delta[i]!;
    for (let x = 0; x < g.w; x++) { w[x] = 0; w[(g.h - 1) * g.w + x] = 0; }
    for (let y = 0; y < g.h; y++) { w[y * g.w] = 0; w[y * g.w + g.w - 1] = 0; }
  }
  let pooled = 0;
  const wet: number[] = [];
  for (let i = 0; i < n; i++) { if (w[i]! > SHOW_ABOVE_M) wet.push(w[i]!); if (w[i]! > 0.5) pooled++; }
  wet.sort((a, b) => a - b);
  const maxDepth = wet.length ? wet[Math.floor(wet.length * 0.5)]! : 0;
  return { depth: w, gx: field.gx, gy: field.gy, maxDepth, pooledKm2: (pooled * g.cellM * g.cellM) / 1e6 };
}

export function depthImagePngBase64(g: Grid, depth: Float32Array): string {
  const png = new PNG({ width: g.w, height: g.h });
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i]!;
    if (d < SHOW_ABOVE_M) continue;
    const t = Math.min(1, (d - SHOW_ABOVE_M) / 2.5);
    const o = i * 4;
    png.data[o] = Math.round(140 - 120 * t);
    png.data[o + 1] = Math.round(205 - 145 * t);
    png.data[o + 2] = Math.round(245 - 105 * t);
    png.data[o + 3] = Math.round(120 + 110 * t);
  }
  return PNG.sync.write(png).toString("base64");
}

export function floodDepths(depth0: number[], inches: number, frac: number, nPolys: number): number[] {
  if (!depth0.length) return Array.from({ length: nPolys }, () => 0);
  const s = (inches * frac) / REF_INCHES;
  return depth0.map((d) => { const v = d * s; return v < DRY_BELOW_M ? 0 : v; });
}

export class RunoffFlowAdapter implements FlowPort {
  async run(opts: {
    grid: Grid; mmRain: number; depth0: number[]; inches: number; stageFraction: number; floodPolys: FloodPoly[];
  }) {
    const depths = floodDepths(opts.depth0, opts.inches, opts.stageFraction, opts.floodPolys.length);
    const floodFc: FeatureCollection = {
      type: "FeatureCollection",
      features: opts.floodPolys.map((p, i) => ({
        type: "Feature",
        properties: { d: Math.round((depths[i] ?? 0) * 100) / 100, i },
        geometry: { type: "Polygon", coordinates: [p.ring] },
      })),
    };
    const wet = depths.filter((d) => d > 0).length;
    const deepest = Math.max(0, ...depths);
    if (!opts.grid?.w) {
      return { depths, floodFc, flow: null, wet, deepest };
    }
    const field = slopeField(opts.grid);
    const r = runoffSync(opts.grid, opts.mmRain, field);
    return {
      depths, floodFc, wet, deepest,
      flow: {
        pooledKm2: r.pooledKm2,
        maxDepth: r.maxDepth,
        imagePngBase64: depthImagePngBase64(opts.grid, r.depth),
        field: { gx: Array.from(field.gx), gy: Array.from(field.gy), acc: Array.from(field.acc) },
        grid: { ...opts.grid, z: Array.from(asFloat(opts.grid.z)) },
      },
    };
  }
}
