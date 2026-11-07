import { describe, expect, it } from "vitest";
import { activeAt, draftAlerts, knownAt, summarize, type Closure } from "../packages/analysis/replay.ts";

const R = (id: number, start: string, end: string | null, extra: Partial<Closure> = {}): Closure => ({
  id, road: "US-221", commonName: null, county: "Avery", division: 11, routeType: "US", condition: "Closed", lanesAffected: "Road Closed", eventType: "Weather Event",
  reason: "The road is closed near Dellinger Road.", detour: null, location: "Near Crossnore / Both Directions", lat: 36, lon: -81.9, start, end, lastUpdate: null, createdAt: "2024-10-15T00:00:00Z", ...extra,
});
const T = (s: string) => Date.parse(s);
const O = { weatherOnly: true };

describe("replay time-slicing", () => {
  const recs = [R(1, "2024-09-26T10:00:00Z", "2024-09-27T10:00:00Z"), R(2, "2024-09-27T00:00:00Z", null), R(3, "2024-09-28T00:00:00Z", "2024-09-29T00:00:00Z")];
  it("never reveals a record that starts after t (no future leakage)", () => {
    const k = knownAt(recs, T("2024-09-26T12:00:00Z"), O);
    expect(k.map((r) => r.id)).toEqual([1]);
    expect(knownAt(recs, T("2024-09-26T09:59:59Z"), O)).toHaveLength(0);
  });
  it("a record ends exactly at its end time (active strictly before end)", () => {
    expect(activeAt(recs, T("2024-09-27T09:59:59Z"), O).map((r) => r.id)).toEqual([1, 2]);
    expect(activeAt(recs, T("2024-09-27T10:00:00Z"), O).map((r) => r.id)).toEqual([2]);
  });
  it("'Open' records are informational, never counted as active restrictions", () => {
    const r = [R(1, "2024-09-26T00:00:00Z", null, { condition: "Open" })];
    expect(knownAt(r, T("2024-09-27T00:00:00Z"), O)).toHaveLength(1);
    expect(activeAt(r, T("2024-09-27T00:00:00Z"), O)).toHaveLength(0);
  });
  it("weather-only and county filters apply", () => {
    const r = [R(1, "2024-09-26T00:00:00Z", null), R(2, "2024-09-26T00:00:00Z", null, { eventType: "Maintenance" }), R(3, "2024-09-26T00:00:00Z", null, { county: "Buncombe" })];
    const t = T("2024-09-27T00:00:00Z");
    expect(activeAt(r, t, { weatherOnly: true }).map((x) => x.id)).toEqual([1, 3]);
    expect(activeAt(r, t, { weatherOnly: false })).toHaveLength(3);
    expect(activeAt(r, t, { weatherOnly: true, county: "Buncombe" }).map((x) => x.id)).toEqual([3]);
  });
  it("summarises counts by condition and county, and reopenings", () => {
    const s = summarize([...recs, R(4, "2024-09-27T01:00:00Z", null, { condition: "Partial Access", county: "Buncombe" })], T("2024-09-28T12:00:00Z"), O);
    expect(s).toMatchObject({ known: 4, active: 3, closed: 2, partial: 1, reopened: 1 });
    expect(s.byCounty[0]).toEqual(["Avery", 2]);
  });
});

describe("rule-based public alert drafts", () => {
  it("drafts only recent, still-active restrictions and marks them for human approval", () => {
    const recs = [R(1, "2024-09-27T00:00:00Z", null), R(2, "2024-09-20T00:00:00Z", null), R(3, "2024-09-27T01:00:00Z", "2024-09-27T02:00:00Z")];
    const a = draftAlerts(recs, T("2024-09-27T06:00:00Z"), O, 12);
    expect(a.map((x) => x.id)).toEqual([1]); // 2 is older than 12h (and before range), 3 already ended
    expect(a[0]!.text).toContain("US-221 is CLOSED in Avery County");
    expect(a[0]!.text).toContain("No detour published");
    expect(a[0]!.severity).toBe("closed");
  });
  it("includes the published detour when there is one", () => {
    const a = draftAlerts([R(1, "2024-09-27T00:00:00Z", null, { detour: "Use NC 194." })], T("2024-09-27T01:00:00Z"), O);
    expect(a[0]!.text).toContain("Detour: Use NC 194.");
  });
});
