/**
 * REAL data layers bundled into the console (small cached files, rebuilt by scripts/fetch_*.mjs).
 *  - Cell sites: OpenCelliD (CC BY-SA 4.0). Positions are real but crowd-sourced estimates. Flood-time status is NOT
 *    public, so it is MODELLED here from the real observed flood extent and labelled as modelled.
 *  - Internet connectivity: IODA (Georgia Tech). Regional only (Bagmati zone), so it shows when, not where.
 *  - Power outages: NASA Black Marble nightly lights. Cells whose lights fell below half of normal after the flood.
 *    Observed, but cloud hides the worst nights, and thin cloud can also dim lights: "likely lost power".
 */
import cellRaw from "../../../data/real/kathmandu/cell_sites.json";
import iodaRaw from "../../../data/real/kathmandu/ioda.json";
import nightRaw from "../../../data/real/kathmandu/night_lights.json";

export type CellSite = {
  id: string; lon: number; lat: number; cells: number; radios: string[]; operators: string[];
  samples: number; firstSeen: string; preEvent: boolean; distFloodM: number;
};
export type CellStatus = "down" | "risk" | "up";

// ---------- Night lights: NASA Black Marble (REAL, observed) ----------
type NlCell = { r: number; c: number; lon: number; lat: number; base: number; flood: number | null; ratio: number | null; nights: number; status: "dark" | "dim" | "normal" | "unseen" };
export type DarkArea = { id: string; name: string; cells: number; areaKm2: number; lon: number; lat: number; medianRatio: number; ring: [number, number][] };
export const NIGHT = nightRaw as unknown as {
  source: string; windows: Record<string, [string, string]>; origin: [number, number]; cellDeg: [number, number]; note: string;
  counts: { lit: number; seenAfterFlood: number; dark: number; dim: number; areas: number; controlFalseDarkRate: number };
  cells: NlCell[]; areas: (DarkArea & { members: [number, number][] })[];
};
/** Clusters of at least this many dark cells become outage areas. Smaller ones are closer to the noise level. */
export const MIN_AREA_CELLS = 3;
export const DARK_AREAS: DarkArea[] = NIGHT.areas.filter((a) => a.cells >= MIN_AREA_CELLS);
const nlByRC = new Map(NIGHT.cells.map((c) => [`${c.r},${c.c}`, c]));
/** The night-lights cell under a point (only lit cells are stored, so dark open ground returns undefined). */
export function nightCellAt(lon: number, lat: number): NlCell | undefined {
  const c = Math.round((lon - NIGHT.origin[0]) / NIGHT.cellDeg[0]), r = Math.round((NIGHT.origin[1] - lat) / NIGHT.cellDeg[1]);
  return nlByRC.get(`${r},${c}`);
}

// ---------- Cell sites ----------
/** Within this distance of the observed flood extent a site counts as at risk (modelled). */
export const CELL_RISK_M = 200;
export const CELL_SITES = (cellRaw as unknown as { sites: CellSite[] }).sites;
export const CELL_META = cellRaw as unknown as { source: string; licence: string; retrievedAt: string; counts: Record<string, number> };

/**
 * Modelled status. Inside the observed flood extent → down. In a cell that went dark at night (lost power, so running on
 * batteries that last hours) or within CELL_RISK_M of the flood → at risk. Otherwise up.
 */
export function cellStatus(s: CellSite): CellStatus {
  if (s.distFloodM === 0) return "down";
  return s.distFloodM <= CELL_RISK_M || nightCellAt(s.lon, s.lat)?.status === "dark" ? "risk" : "up";
}

type Series = { stepSec: number; t0: number; values: (number | null)[]; baseline: number; floodMin: number; floodMinAt: string; dropPct: number };
type IodaEntity = { type: string; code: string; label: string; series: Record<string, Series> };
export const IODA = iodaRaw as unknown as { source: string; licence: string; retrievedAt: string; note: string; entities: IodaEntity[] };
/** Bagmati zone (contains the Kathmandu valley). */
export const IODA_REGION = IODA.entities.find((e) => e.type === "region")!;

/** "07:45 on 28 Sep" in Nepal time (UTC+5:45). */
export function nepalTime(iso: string): string {
  const d = new Date(Date.parse(iso) + (5 * 60 + 45) * 60000);
  const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} on ${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}
