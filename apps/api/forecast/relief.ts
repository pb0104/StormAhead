/**
 * "Which areas have lost power / cell service / sit under the heaviest rain / near landslides, and what relief do they
 * need?" — joins the last Resource allocation plan (per-area people, cost, QRT or helicopter) with hazard locations.
 * The geography is done here, not by the LLM. Areas match a hazard when they lie within its radius.
 */
import { lastResourcePlan, load, rainStats, type AreaAllocation, type Ctx } from "./agents.ts";

type Pt = [number, number];
export type Hazard = "power" | "cell" | "rain" | "landslide";
export const HAZARDS: Hazard[] = ["power", "cell", "rain", "landslide"];
const km = (a: Pt, b: Pt) => Math.hypot((a[0] - b[0]) * 98.6, (a[1] - b[1]) * 110.6);

type Spot = { at: Pt; label: string; radiusKm: number };

/** Where each hazard is, from the same real data the agents use. */
function hazardSpots(h: Hazard, plan: { start?: number; end?: number }): { spots: Spot[]; source: string } {
  if (h === "power") {
    const n = load<{ areas: { name: string; lon: number; lat: number; areaKm2: number; cells: number }[] }>("real/kathmandu/night_lights.json");
    return {
      source: "NASA Black Marble night lights: areas that went dark after the flood (3+ cells)",
      spots: n.areas.filter((a) => a.cells >= 3).map((a) => ({ at: [a.lon, a.lat], label: `${a.name.replace(/^Dark area near /, "dark area near ")} (${a.areaKm2} km²)`, radiusKm: Math.max(1, Math.sqrt(a.areaKm2 / Math.PI) + 0.5) })),
    };
  }
  if (h === "cell") {
    const c = load<{ sites: { id: string; lon: number; lat: number; distFloodM: number; operators: string[] }[] }>("real/kathmandu/cell_sites.json");
    return {
      source: "OpenCelliD sites: down if inside the observed flood extent, at risk within 200 m of it",
      spots: c.sites.filter((s) => s.distFloodM <= 200).map((s) => ({ at: [s.lon, s.lat], label: `cell site ${s.id} ${s.distFloodM === 0 ? "down (in flood water)" : `at risk (${s.distFloodM} m from water)`}`, radiusKm: 1 })),
    };
  }
  if (h === "landslide") {
    const H = load<{ incidents: { title?: string; on: string; lon: number; lat: number; hazard: string }[] }>("real/kathmandu/incidents_history.json");
    return {
      source: "BIPAD landslide incidents 2021–2024 (past failures mark susceptible slopes)",
      spots: H.incidents.filter((i) => /landslide/i.test(i.hazard)).map((i) => ({ at: [i.lon, i.lat], label: `landslide ${i.on.slice(0, 4)}${i.title ? `: ${i.title.replace(/^Landslide (at|in) /i, "")}` : ""}`, radiusKm: 1.5 })),
    };
  }
  // rain: the wettest third of gauges in the plan's window (at least 3).
  const start = plan.start ?? 0, end = plan.end ?? start + 24;
  const rs = rainStats({ start, end, hours: end - start, memo: new Map() } as unknown as Ctx);
  const ranked = [...rs.stations].sort((a, b) => b.max24 - a.max24);
  const top = ranked.slice(0, Math.max(3, Math.ceil(ranked.length / 3))).filter((s) => s.max24 > 0);
  return {
    source: "DHM rain gauges (BIPAD): the wettest third of gauges by heaviest 24 h in the forecast window",
    spots: top.map((s) => ({ at: s.at, label: `${s.title} gauge, ${Math.round(s.max24)} mm in 24 h`, radiusKm: 3 })),
  };
}

const npr = (n: number) => `NPR ${n >= 1e7 ? `${(n / 1e7).toFixed(2)} crore` : n >= 1e5 ? `${(n / 1e5).toFixed(1)} lakh` : Math.round(n).toLocaleString("en-US")}`;

export function reliefNear(hazards: Hazard[], opts: { place?: Pt | null; placeName?: string | null; radiusKm?: number } = {}) {
  const plan = lastResourcePlan();
  if (!plan || !plan.areas.length) {
    return { ok: false as const, error: plan ? "The last relief plan allocated nothing (rain too light for displacement)." : "The Relief budget agent has not run yet. Deploy it (agent id 'resources') with the others, then ask again." };
  }
  const per = hazards.map((h) => ({ h, ...hazardSpots(h, plan) }));
  const rows = plan.areas.map((a: AreaAllocation) => {
    const hits = per.flatMap(({ h, spots }) => {
      let best: Spot | null = null, bd = Infinity;
      for (const s of spots) { const d = km([a.lon, a.lat], s.at); if (d <= (opts.radiusKm ?? s.radiusKm) && d < bd) { bd = d; best = s; } }
      return best ? [{ hazard: h, what: best.label, km: Math.round(bd * 10) / 10 }] : [];
    });
    return { a, hits };
  });
  let matched = rows.filter((r) => (hazards.length > 1 ? r.hits.length >= 2 : r.hits.length >= 1));
  if (opts.place) matched = matched.filter((r) => km([r.a.lon, r.a.lat], opts.place!) <= 3);
  matched.sort((x, y) => y.hits.length - x.hits.length || y.a.people - x.a.people);
  const sum = (f: (a: AreaAllocation) => number) => matched.reduce((s, r) => s + f(r.a), 0);
  return {
    ok: true as const,
    window: plan.window, hazards, near: opts.placeName ?? null,
    rule: hazards.length > 1 ? "Areas hit by at least two of these hazards, most hazards first." : "Areas within reach of this hazard, most people first.",
    sources: Object.fromEntries(per.map((p) => [p.h, p.source])),
    totals: {
      areas: matched.length, people: sum((a) => a.people), households: sum((a) => a.households),
      allocated: npr(sum((a) => a.allocated)), perDayEmergency: npr(sum((a) => a.perDay)),
      qrtTeams: sum((a) => a.qrtTeams), helicopterAreas: matched.filter((r) => r.a.by === "helicopter").length,
      foodKgPerDay: sum((a) => a.foodKgPerDay), waterLPerDay: sum((a) => a.waterLPerDay), shelterKits: sum((a) => a.shelterKits),
    },
    fund: { daysCovered: plan.daysCovered, requestNationalAidBy: plan.askBy },
    areas: matched.slice(0, 12).map(({ a, hits }) => ({
      id: a.id, place: a.place, lon: a.lon, lat: a.lat, people: a.people, households: a.households,
      reach: a.by === "helicopter" ? "helicopter (cut off by road)" : "road", from: a.from, qrtTeams: a.qrtTeams,
      allocated: a.allocatedLabel, perDay: a.perDayLabel, vehicles: a.vehicles.map((v) => `${v.count} × ${v.label}`),
      hazards: hits,
    })),
    note: "People are upper-bound estimates from census density on the 2024 flood extent; vehicle and QRT rates are mocked. Hazard layers are real data.",
  };
}
