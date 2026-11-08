/**
 * The area card: click a spot in the valley and get its ward, the 2021 census for its municipality, how many people live on
 * ground the 2024 flood covered, and what relief for them would cost per day (same cost model as the resource agent).
 *
 * Sources: ward boundaries from OpenStreetMap (wards.json); census from BIPAD (census_municipality.json, municipality level
 * only, so the ward population is an estimate); people on flooded ground from need.ts (UNOSAT extent × census density).
 */
import type { Services } from "../../../packages/app/index.ts";
import { exposedIn } from "../actions/need.ts";
import { basicPerPersonDay, costArea, costThrough, lastResourcePlan, load, money, RELIEF } from "./agents.ts";

type Ring = [number, number][];
type OsmWard = { id: number; name: string; ward: string; municipality: string; areaM2: number; at: [number, number]; rings: Ring[] };
type BipadWard = { id: number; name: string; municipality: number; lon: number; lat: number };
type Muni = { municipality: number; name: string; wards: number | null; population: number; households: number; male: number; female: number; under5: number; over65: number };

function inRings(x: number, y: number, rings: Ring[]) {
  let c = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const km = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 98.6, (a[1] - b[1]) * 110.6);

export async function areaAt(services: Services, lon: number, lat: number) {
  const wards = load<{ wards: OsmWard[] }>("real/kathmandu/wards.json").wards;
  const ward = wards.find((w) => inRings(lon, lat, w.rings));
  if (!ward) return { found: false as const, lon, lat, message: "No ward boundary here. Click inside the Kathmandu valley." };

  // Municipality: the BIPAD ward whose centroid falls inside this OSM ward (else the nearest one). Spatial, so spelling
  // differences between OSM and BIPAD names don't matter.
  const bw = load<{ wards: BipadWard[] }>("real/kathmandu/wards_bipad.json").wards;
  const match = bw.find((b) => inRings(b.lon, b.lat, ward.rings)) ?? bw.reduce((a, b) => (km([b.lon, b.lat], ward.at) < km([a.lon, a.lat], ward.at) ? b : a), bw[0]!);
  const census = load<{ source: string; municipalities: Muni[] }>("real/kathmandu/census_municipality.json");
  const muni = census.municipalities.find((m) => m.municipality === match.municipality) ?? null;
  const wardEst = muni?.wards ? Math.round(muni.population / muni.wards / 10) * 10 : null;

  const exposed = exposedIn(ward.rings);
  const plan = lastResourcePlan();
  const share = plan?.needShare ?? RELIEF.needShare;
  const need = Math.round((exposed.people * share) / 10) * 10;
  const scene = await services.scene.load();
  const pockets = scene.entities.filter((e) => e.kind === "pocket").map((e) => ({ at: e.at as [number, number] }));
  const c = costArea(need, ward.at, pockets);
  const days = Math.min(plan?.daysCovered ?? RELIEF.horizonDays, RELIEF.horizonDays), E = RELIEF.emergencyDays;
  const got = costThrough(days, c.kits, c.perDay, c.perDayAfter), full = costThrough(RELIEF.horizonDays, c.kits, c.perDay, c.perDayAfter);
  return {
    found: true as const, lon, lat,
    ward: { name: ward.name, number: ward.ward, municipality: ward.municipality, areaKm2: Math.round(ward.areaM2 / 1e4) / 100, rings: ward.rings },
    census: muni && {
      municipality: muni.name, population: muni.population, households: muni.households, under5: muni.under5, over65: muni.over65, wards: muni.wards,
      wardEstimate: wardEst, source: "Census 2021 via BIPAD (municipality level)",
    },
    exposure: { people: exposed.people, floodedKm2: exposed.floodedKm2, basis: "People living on ground the 30 Sep 2024 flood covered (UNOSAT extent × 2021 census density). Upper bound." },
    relief: need > 0 ? {
      people: need, households: c.households, shareUsed: share,
      perDay: Math.round(c.perDay), perDayLabel: money(c.perDay), perDayAfterLabel: money(c.perDayAfter), emergencyDays: E,
      breakdown: [
        { item: `Basic needs: food, water, hygiene (Nepal MEB, ≈ NPR ${Math.round(basicPerPersonDay())}/person)`, npr: Math.round(c.basic), label: money(c.basic) },
        { item: "Vehicle hire (see vehicles below)", npr: Math.round(c.transport), label: money(c.transport) },
        { item: `${c.qrtTeams} QRT team${c.qrtTeams === 1 ? "" : "s"} (crew)`, npr: Math.round(c.qrt), label: money(c.qrt) },
      ],
      vehicles: c.vehicles.map((v) => ({ ...v, perDayEachLabel: money(v.perDayEach), perDayLabel: money(v.perDay) })),
      kits: Math.round(c.kits), kitsLabel: money(c.kits),
      allocated: Math.round(got), allocatedLabel: money(got), fullNeedLabel: money(full), days, horizonDays: RELIEF.horizonDays,
      by: c.cutOff ? "helicopter" : "road", from: c.cutOff ? "Tribhuvan International Airport" : `${c.base.name} (${c.base.type}, ~${Math.round(c.roadKm * 10) / 10} km by road)`,
    } : null,
    plan: plan
      ? `Costed on the last resource-agent run (${plan.window}): ${Math.round(share * 100)}% of people on flooded ground need relief${plan.daysCovered !== null ? `; the emergency fund lasts ${plan.daysCovered} day${plan.daysCovered === 1 ? "" : "s"}, so this area's allocation covers that long` : ""}.`
      : `No resource-agent run yet, so this assumes 2024-level rain (${Math.round(share * 100)}% of people on flooded ground need relief) for ${RELIEF.horizonDays} days.`,
    // When this ward needs nothing, point to the nearest area that does (from the last run).
    nearest: need > 0 || !plan?.areas.length ? null : (() => {
      const a = plan.areas.reduce((b, x) => (km([x.lon, x.lat], [lon, lat]) < km([b.lon, b.lat], [lon, lat]) ? x : b), plan.areas[0]!);
      return { ...a, km: Math.round(km([a.lon, a.lat], [lon, lat]) * 10) / 10 };
    })(),
    mocked: "Basic needs, shelter kits and the share in need are anchored on Nepal's 2024 flood response; vehicle and QRT rates are mocked.",
  };
}
