/**
 * Flow agent: rain-on-grid runoff over the real elevation grid.
 * Every cell starts with the same depth of runoff. Each step, a cell passes part of its water to its lowest neighbour (by
 * water-surface height, so ponds fill and spill over). Water drains off slopes and collects in channels and low ground.
 * It is a teaching model: no infiltration map, no drainage network, no buildings, and a 70 m grid. It is not a flood forecast.
 */
export type Grid = { w: number; h: number; lon0: number; lon1: number; lat0: number; lat1: number; cellM: number; z: Float32Array };
/** `maxDepth` is the MEDIAN depth of cells holding more than 0.25 m (the name is kept for the callers). */
export type Runoff = { depth: Float32Array; gx: Float32Array; gy: Float32Array; maxDepth: number; pooledKm2: number };

export const RUNOFF_COEF = 0.7, SHOW_ABOVE_M = 0.25, STEPS = 220;
const NB: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** How many cells drain through each cell (D8 flow accumulation). High values are the main channels. */
export function flowAccumulation(g: Grid): Float32Array {
  const n = g.w * g.h, acc = new Float32Array(n).fill(1);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => g.z[b]! - g.z[a]!);
  for (const i of order) {
    const x = i % g.w, y = (i - x) / g.w;
    if (x < 1 || y < 1 || x > g.w - 2 || y > g.h - 2) continue;
    let best = -1, bz = g.z[i]!;
    for (const [dx, dy] of NB) { const j = i + dy * g.w + dx; if (g.z[j]! < bz) { bz = g.z[j]!; best = j; } }
    if (best >= 0) acc[best]! += acc[i]!;
  }
  return acc;
}

/** Ground gradient in m per m, grid axes (x east, y south). Water moves along -(gx, gy). */
export function slopeField(g: Grid): { gx: Float32Array; gy: Float32Array; acc: Float32Array } {
  const gx = new Float32Array(g.w * g.h), gy = new Float32Array(g.w * g.h);
  for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
    const i = y * g.w + x;
    gx[i] = (g.z[i + 1]! - g.z[i - 1]!) / (2 * g.cellM);
    gy[i] = (g.z[i + g.w]! - g.z[i - g.w]!) / (2 * g.cellM);
  }
  return { gx, gy, acc: flowAccumulation(g) };
}

/** `mmRain` is the rain that has fallen so far. Yields to the browser every few steps. Returns null if cancelled. */
export async function runoff(g: Grid, mmRain: number, cancelled: () => boolean, field: { gx: Float32Array; gy: Float32Array; acc: Float32Array }): Promise<Runoff | null> {
  const n = g.w * g.h, w = new Float32Array(n).fill((mmRain / 1000) * RUNOFF_COEF), delta = new Float32Array(n);
  for (let step = 0; step < STEPS; step++) {
    delta.fill(0);
    for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
      const i = y * g.w + x, wi = w[i]!;
      if (wi < 1e-4) continue;
      const hi = g.z[i]! + wi;
      let best = -1, bh = hi;
      for (const [dx, dy] of NB) { const j = i + dy * g.w + dx, hj = g.z[j]! + w[j]!; if (hj < bh) { bh = hj; best = j; } }
      if (best >= 0) { const amt = Math.min(wi, (hi - bh) * 0.6); delta[i]! -= amt; delta[best]! += amt; }
    }
    for (let i = 0; i < n; i++) w[i]! += delta[i]!;
    // The grid edge is an outlet: water that reaches it leaves the valley.
    for (let x = 0; x < g.w; x++) { w[x] = 0; w[(g.h - 1) * g.w + x] = 0; }
    for (let y = 0; y < g.h; y++) { w[y * g.w] = 0; w[y * g.w + g.w - 1] = 0; }
    if (step % 20 === 19) { await new Promise((r) => setTimeout(r, 0)); if (cancelled()) return null; }
  }
  let pooled = 0;
  const wet: number[] = [];
  for (let i = 0; i < n; i++) { if (w[i]! > SHOW_ABOVE_M) wet.push(w[i]!); if (w[i]! > 0.5) pooled++; }
  wet.sort((a, b) => a - b);
  const maxDepth = wet.length ? wet[Math.floor(wet.length * 0.5)]! : 0; // median depth of wet cells: single noisy DEM pits do not set the headline
  return { depth: w, gx: field.gx, gy: field.gy, maxDepth, pooledKm2: (pooled * g.cellM * g.cellM) / 1e6 };
}

/** Depth raster as a PNG data URL: transparent below SHOW_ABOVE_M, light to dark blue with depth. */
export function depthImage(g: Grid, depth: Float32Array): string {
  const c = document.createElement("canvas"); c.width = g.w; c.height = g.h;
  const ctx = c.getContext("2d")!, img = ctx.createImageData(g.w, g.h);
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i]!;
    if (d < SHOW_ABOVE_M) continue;
    const t = Math.min(1, (d - SHOW_ABOVE_M) / 2.5);
    img.data[i * 4] = Math.round(140 - 120 * t); img.data[i * 4 + 1] = Math.round(205 - 145 * t); img.data[i * 4 + 2] = Math.round(245 - 105 * t);
    img.data[i * 4 + 3] = Math.round(120 + 110 * t);
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}
