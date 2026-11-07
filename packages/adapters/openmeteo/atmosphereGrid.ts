/**
 * Pure helpers: valley weather grid → soft cloud samples + smoothed pressure isobars.
 * Open-Meteo samples are upsampled so contours look fluid (still illustrative, not NWP-grade).
 */
import type { Feature, FeatureCollection } from "../../ports/index.ts";

export type AtmGrid = {
  lons: number[];
  lats: number[];
  /** row-major: pressure[latIdx][lonIdx] hPa */
  pressure: number[][];
  /** row-major: cloud[latIdx][lonIdx] % */
  cloud: number[][];
};

const fc = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function bilinear(grid: number[][], j: number, i: number, fj: number, fi: number): number {
  const j0 = Math.min(j, grid.length - 2), i0 = Math.min(i, (grid[0]?.length ?? 1) - 2);
  const v00 = grid[j0]![i0]!, v10 = grid[j0]![i0 + 1]!, v01 = grid[j0 + 1]![i0]!, v11 = grid[j0 + 1]![i0 + 1]!;
  const a = lerp(v00, v10, fi), b = lerp(v01, v11, fi);
  return lerp(a, b, fj);
}

/** Upsample a coarse Open-Meteo grid for smoother contours / heatmaps. */
export function refineGrid(grid: AtmGrid, factor = 4): AtmGrid {
  const { lons, lats, pressure, cloud } = grid;
  if (lons.length < 2 || lats.length < 2 || factor <= 1) return grid;
  const nLon = (lons.length - 1) * factor + 1;
  const nLat = (lats.length - 1) * factor + 1;
  const outLons: number[] = [];
  const outLats: number[] = [];
  for (let i = 0; i < nLon; i++) {
    const t = i / factor, i0 = Math.min(Math.floor(t), lons.length - 2), fi = t - i0;
    outLons.push(lerp(lons[i0]!, lons[i0 + 1]!, fi));
  }
  for (let j = 0; j < nLat; j++) {
    const t = j / factor, j0 = Math.min(Math.floor(t), lats.length - 2), fj = t - j0;
    outLats.push(lerp(lats[j0]!, lats[j0 + 1]!, fj));
  }
  const outP: number[][] = [];
  const outC: number[][] = [];
  for (let j = 0; j < nLat; j++) {
    const tj = j / factor, j0 = Math.min(Math.floor(tj), lats.length - 2), fj = tj - j0;
    const rowP: number[] = [], rowC: number[] = [];
    for (let i = 0; i < nLon; i++) {
      const ti = i / factor, i0 = Math.min(Math.floor(ti), lons.length - 2), fi = ti - i0;
      rowP.push(bilinear(pressure, j0, i0, fj, fi));
      rowC.push(bilinear(cloud, j0, i0, fj, fi));
    }
    outP.push(rowP);
    outC.push(rowC);
  }
  return { lons: outLons, lats: outLats, pressure: outP, cloud: outC };
}

/** Weighted points for MapLibre heatmap (fluid cloud field). */
export function cloudHeatPoints(grid: AtmGrid, threshold = 8): FeatureCollection {
  const features: Feature[] = [];
  const { lons, lats, cloud } = grid;
  for (let j = 0; j < lats.length; j++) {
    for (let i = 0; i < lons.length; i++) {
      const v = cloud[j]?.[i];
      if (v == null || v < threshold) continue;
      features.push({
        type: "Feature",
        properties: { cloud_cover: v, kind: "cloud", weight: v / 100 },
        geometry: { type: "Point", coordinates: [lons[i]!, lats[j]!] },
      });
    }
  }
  return fc(features);
}

/** @deprecated kept for tests — prefer cloudHeatPoints */
export function cloudPolygons(grid: AtmGrid, threshold = 25): FeatureCollection {
  return cloudHeatPoints(grid, threshold);
}

/** Chaikin corner-cutting for fluid isobar curves. */
export function smoothLine(coords: [number, number][], iterations = 3): [number, number][] {
  let pts = coords;
  for (let n = 0; n < iterations; n++) {
    if (pts.length < 3) break;
    const next: [number, number][] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
  }
  return pts;
}

/** Marching-squares style segments for one isobar level on the grid. */
function isobarSegments(grid: AtmGrid, level: number): [number, number][][] {
  const { lons, lats, pressure: p } = grid;
  const segs: [number, number][][] = [];
  const edge = (i0: number, j0: number, i1: number, j1: number, v0: number, v1: number): [number, number] | null => {
    if ((v0 - level) * (v1 - level) > 0) return null;
    if (v0 === v1) return null;
    const t = (level - v0) / (v1 - v0);
    return [lerp(lons[i0]!, lons[i1]!, t), lerp(lats[j0]!, lats[j1]!, t)];
  };
  for (let j = 0; j < lats.length - 1; j++) {
    for (let i = 0; i < lons.length - 1; i++) {
      const v00 = p[j]![i]!, v10 = p[j]![i + 1]!, v01 = p[j + 1]![i]!, v11 = p[j + 1]![i + 1]!;
      const pts: ([number, number] | null)[] = [
        edge(i, j, i + 1, j, v00, v10),
        edge(i + 1, j, i + 1, j + 1, v10, v11),
        edge(i, j + 1, i + 1, j + 1, v01, v11),
        edge(i, j, i, j + 1, v00, v01),
      ];
      const hit = pts.filter((x): x is [number, number] => !!x);
      if (hit.length >= 2) segs.push([hit[0]!, hit[1]!]);
      if (hit.length === 4) segs.push([hit[2]!, hit[3]!]);
    }
  }
  return segs;
}

/** Chain short segments into polylines (greedy). */
function chainSegments(segs: [number, number][][]): [number, number][][] {
  const left = segs.map((s) => s.slice() as [number, number][]);
  const lines: [number, number][][] = [];
  const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-5;
  while (left.length) {
    let line = left.pop()!;
    let grew = true;
    while (grew) {
      grew = false;
      for (let k = left.length - 1; k >= 0; k--) {
        const s = left[k]!;
        const a = line[0]!, b = line[line.length - 1]!;
        if (near(b, s[0]!)) { line = line.concat(s.slice(1)); left.splice(k, 1); grew = true; }
        else if (near(b, s[1]!)) { line = line.concat(s.slice(0, -1).reverse()); left.splice(k, 1); grew = true; }
        else if (near(a, s[1]!)) { line = s.slice(0, -1).concat(line); left.splice(k, 1); grew = true; }
        else if (near(a, s[0]!)) { line = s.slice(1).reverse().concat(line); left.splice(k, 1); grew = true; }
      }
    }
    if (line.length >= 2) lines.push(line);
  }
  return lines;
}

export function pressureIsobars(grid: AtmGrid, stepHpa = 1): FeatureCollection {
  const flat = grid.pressure.flat().filter((n) => Number.isFinite(n));
  if (!flat.length) return fc([]);
  const lo = Math.floor(Math.min(...flat) / stepHpa) * stepHpa;
  const hi = Math.ceil(Math.max(...flat) / stepHpa) * stepHpa;
  const features: Feature[] = [];
  for (let level = lo; level <= hi; level += stepHpa) {
    const lines = chainSegments(isobarSegments(grid, level));
    for (const raw of lines) {
      if (raw.length < 3) continue; // skip tiny stubs; smooth longer runs
      const coordinates = smoothLine(raw, 3);
      features.push({
        type: "Feature",
        properties: { pressure_hpa: level, kind: "isobar" },
        geometry: { type: "LineString", coordinates },
      });
    }
  }
  return fc(features);
}

/** Local pressure extrema → H / L labels (on the coarse / refined grid). */
export function pressureCenters(grid: AtmGrid): FeatureCollection {
  const { lons, lats, pressure: p } = grid;
  const features: Feature[] = [];
  for (let j = 1; j < lats.length - 1; j++) {
    for (let i = 1; i < lons.length - 1; i++) {
      const v = p[j]![i]!;
      let high = true, low = true;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const n = p[j + dj]![i + di]!;
          if (n >= v) high = false;
          if (n <= v) low = false;
        }
      }
      if (!high && !low) continue;
      features.push({
        type: "Feature",
        properties: {
          kind: high ? "high" : "low",
          label: high ? "H" : "L",
          pressure_hpa: Math.round(v * 10) / 10,
        },
        geometry: { type: "Point", coordinates: [lons[i]!, lats[j]!] },
      });
    }
  }
  return fc(features);
}

export function buildAtmosphereLayers(grid: AtmGrid) {
  const fine = refineGrid(grid, 4);
  return {
    clouds: cloudHeatPoints(fine),
    isobars: pressureIsobars(fine, 1),
    // Centers on a lightly refined grid so H/L don't multiply.
    centers: pressureCenters(refineGrid(grid, 2)),
  };
}
