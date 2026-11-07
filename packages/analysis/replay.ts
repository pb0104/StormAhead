/**
 * Replay logic for the Helene road-closure view. Pure functions (no Node APIs) so the browser and tests share them.
 *
 * Time-slicing rule: at replay time t a viewer may only see a record whose START is <= t. Records still "active" at t are those
 * with no end, or an end after t. NOTE: NCDOT entered these records AFTER the event (see `createdAt`), so this is a
 * RECONSTRUCTED timeline, not an archive of what DriveNC showed live.
 */
export type Closure = {
  id: number; road: string; commonName: string | null; county: string; division: number | null; routeType: string | null;
  condition: "Closed" | "Partial Access" | "Open" | string; lanesAffected: string | null; eventType: string | null;
  reason: string; detour: string | null; location: string | null; lat: number; lon: number;
  start: string; end: string | null; lastUpdate: string | null; createdAt: string | null; createdBy?: string | null;
};
export const WEATHER_TYPES = ["Weather Event", "Road Obstruction", "Emergency Road Work"];
export type ReplayOptions = { weatherOnly: boolean; county?: string | null };

const ms = (s: string | null) => (s ? Date.parse(s) : NaN);
const passes = (r: Closure, o: ReplayOptions) => (!o.weatherOnly || WEATHER_TYPES.includes(r.eventType ?? "")) && (!o.county || r.county === o.county);

/** Everything a viewer may know at time t (never anything that starts later). */
export function knownAt(records: Closure[], t: number, o: ReplayOptions): Closure[] {
  return records.filter((r) => passes(r, o) && ms(r.start) <= t);
}
/** Active restrictions at t: started, not ended, and not an "Open" (informational) record. */
export function activeAt(records: Closure[], t: number, o: ReplayOptions): Closure[] {
  return knownAt(records, t, o).filter((r) => r.condition !== "Open" && !(ms(r.end) <= t));
}
export function summarize(records: Closure[], t: number, o: ReplayOptions) {
  const known = knownAt(records, t, o), act = activeAt(records, t, o);
  const byCounty: Record<string, number> = {};
  for (const r of act) byCounty[r.county] = (byCounty[r.county] ?? 0) + 1;
  return {
    known: known.length, active: act.length,
    closed: act.filter((r) => r.condition === "Closed").length, partial: act.filter((r) => r.condition === "Partial Access").length,
    newLast6h: known.filter((r) => r.condition !== "Open" && t - ms(r.start) < 6 * 3.6e6).length,
    reopened: known.filter((r) => r.condition !== "Open" && ms(r.end) <= t).length,
    byCounty: Object.entries(byCounty).sort((a, b) => b[1] - a[1]),
  };
}

export type DraftAlert = { id: number; road: string; county: string; severity: "closed" | "partial"; start: string; text: string };
/** Rule-based public-alert DRAFTS for restrictions that began in the last `hours` and are still active. A person must approve. */
export function draftAlerts(records: Closure[], t: number, o: ReplayOptions, hours = 12): DraftAlert[] {
  return activeAt(records, t, o).filter((r) => t - ms(r.start) < hours * 3.6e6).sort((a, b) => ms(b.start) - ms(a.start)).map((r) => {
    const where = r.location ? ` (${r.location.replace(/\s*\/\s*Both Directions/i, "")})` : "";
    const verb = r.condition === "Closed" ? "CLOSED" : "PARTIALLY OPEN";
    return {
      id: r.id, road: r.road, county: r.county, severity: r.condition === "Closed" ? "closed" as const : "partial" as const, start: r.start,
      text: `${r.road || "Road"} is ${verb} in ${r.county} County${where}. ${r.reason ? r.reason.replace(/\.?\s*$/, ".") : ""}${r.detour ? ` Detour: ${r.detour}` : " No detour published — avoid the area."}`.replace(/\s+/g, " ").trim(),
    };
  });
}

/** Replay range helper (inclusive start, exclusive end), in ms. */
export const REPLAY_RANGE = { start: Date.parse("2024-09-24T00:00:00Z"), end: Date.parse("2024-10-08T00:00:00Z") };
