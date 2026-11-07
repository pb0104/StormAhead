/**
 * REAL layers for the console, built by scripts/build_ops_layers.ts into data/real/kathmandu/ops_layers.json.
 * Places and records are real (BIPAD Portal). Each facility's status is MODELLED: the closure rule on the real road network
 * under the observed UNOSAT flood of 30 Sep 2024, which is the flood the console draws. Nothing here is a forecast.
 */
import raw from "../../../../data/real/kathmandu/ops_layers.json";
import googleRaw from "../../../../data/real/kathmandu/google_places.json";
import foodRaw from "../../../../data/real/kathmandu/google_food.json";
import type { Entity, Geometry } from "../../../../packages/ports/index.ts";

type Status = { access: "ok" | "degraded" | "lost" | "unknown"; why: string; extraMin: number | null; nearestClosedM: number | null; nearestClosed: string | null };
type Place = Status & { id: number; name: string; at: [number, number]; source: string | null; updated: string };
type Hospital = Place & { type: string | null; ownership: string | null; beds: number | null };
type Ops = {
  sources: Record<string, string>; closedSegments: number;
  hospitals: Hospital[]; schools: Place[]; openSpaces: Place[]; responders: (Place & { type: string })[]; army: Place[]; airports: Place[];
  alerts: { id: number; title: string; hazard: string; startedOn: string; expireOn: string | null; at: [number, number]; wards: number[]; verified: boolean }[];
  gauges: { id: number; name: string; at: [number, number]; warningLevel: number; dangerLevel: number; peak: number; peakAt: string; firstWarning: string | null; firstDanger: string | null; lastReading: string; readings: number }[];
  landslides: { id: number; title: string; on: string; at: [number, number]; deaths: number; injured: number; families: number }[];
  weather: { source: string; times: string[]; valleyMeanMm: number[]; max24hMm: number; max24hEnd: string; peakMmH: number; peakAt: string; total2728Mm: number; era5Total2728Mm: number;
    cells: { at: [number, number]; total2728Mm: number; peakMmH: number }[] };
};
export const OPS = raw as unknown as Ops;

export type Provenance = "real" | "modelled" | "simulated";
/** What the drawer shows: where the item comes from, and where its status comes from. */
export const PROVENANCE = {
  placeModelled: { tag: "real", text: "Real place (BIPAD). Status modelled from the observed flood" },
  record: { tag: "real", text: "Real record (BIPAD)" },
  post: { tag: "real", text: "Real post (Reddit, via Arctic Shift). Place matched by name" },
  cellModelled: { tag: "modelled", text: "Real OpenCelliD position. Status modelled from flood + night lights" },
  nightLights: { tag: "real", text: "NASA Black Marble night lights · likely power loss" },
  googlePlaces: { tag: "real", text: "Google Places (live snapshot). Status not flood-modelled" },
  modelled: { tag: "modelled", text: "Modelled from the observed flood (UNOSAT, 30 Sep 2024)" },
  simulated: { tag: "simulated", text: "Simulated for the demo. No public feed" },
} as const;

type GPlace = { id: string; name: string; at: [number, number]; address?: string | null; types?: string[]; kind: string };
type GooglePack = { careHomes: GPlace[]; fireStations: GPlace[]; police: GPlace[]; hospitals: GPlace[] };
export const GOOGLE = googleRaw as unknown as GooglePack;

type FoodShop = {
  id: string; name: string; at: [number, number]; address?: string | null;
  shopKind: "grocery" | "convenience" | "wholesaler"; status: "lost" | "degraded" | "usable"; why: string;
};
type PocketFood = {
  id: string; name: string; mid: [number, number]; localSummary: string; statusSummary: string; summary: string;
  counts: Record<string, number>; nearbyStatus: Record<string, number>;
};
type PocketTravel = {
  pocketId: string; summary: string; closestId: string | null; fastestNowId: string | null;
  depots: { id: string; name: string; googleMin: number | null; nowMin: number | null }[];
};
type FoodPack = {
  depots: { id: string; name: string; at: [number, number]; packs: number }[];
  shops: FoodShop[];
  pocketSupply: PocketFood[];
  travel: PocketTravel[];
};
export const FOOD = foodRaw as unknown as FoodPack;
export const POCKET_FOOD = new Map(FOOD.pocketSupply.map((p) => [p.id, p]));
export const POCKET_TRAVEL = new Map(FOOD.travel.map((t) => [t.pocketId, t]));

const pt = (at: [number, number]): Extract<Geometry, { type: "Point" }> => ({ type: "Point", coordinates: at });

/** Simulated relief depots (stock invented) + Google Places shops with modelled status. */
export const FOOD_DEPOTS: Entity[] = FOOD.depots.map((d) => ({
  kind: "food" as const, id: d.id, name: d.name, at: d.at, geom: pt(d.at),
  props: { packs: d.packs, role: "depot", shopKind: "depot", status: "usable", prov: "simulated" },
}));
const shopAccess = (s: FoodShop) => (s.status === "lost" ? "lost" : s.status === "degraded" ? "degraded" : "ok");
export const FOOD_SHOPS: Entity[] = FOOD.shops.map((s, i) => ({
  kind: "food" as const,
  id: `FS-${i + 1}`,
  name: s.name,
  at: s.at,
  geom: pt(s.at),
  props: {
    packs: 0, role: "shop", shopKind: s.shopKind, status: s.status, access: shopAccess(s),
    why: s.why, address: s.address ?? "", placeId: s.id, prov: "googlePlaces",
  },
}));
const circle = (at: [number, number], m: number): Extract<Geometry, { type: "Polygon" }> => {
  const ring: [number, number][] = [];
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; ring.push([at[0] + (Math.cos(a) * m) / 98600, at[1] + (Math.sin(a) * m) / 110600]); }
  return { type: "Polygon", coordinates: [ring] };
};
/** "unknown" draws as a plain icon and never counts as at risk. */
const access = (s: Status) => (s.access === "unknown" ? "none" : s.access);
const statusProps = (s: Status) => ({ access: access(s), why: s.why, extraMin: s.extraMin ?? 0, closureM: s.nearestClosedM ?? 0, closure: s.nearestClosed ?? "", prov: "placeModelled" });
export const atRisk = (e: Entity) => e.props.access === "lost" || e.props.access === "degraded";
const hhmm = (s: string | null) => (s ? `${s.slice(8, 10)} Sep ${s.slice(11, 16)}` : "");

const MAJOR_TYPE = /central|teaching|academy|specialist|specialized|children|emergency/i;
const GOVERNMENT = /government|ministry/i;
const NOT_HOSPITAL_TYPE = /veterinary|pharmacy|health post|poly clinic|basic health|nursing home|rehabilitation/i;

/** All registered hospitals with a status. The map shows government and teaching hospitals, plus any that lose access. */
export const ALL_HOSPITALS: Entity[] = OPS.hospitals.filter((h) => !NOT_HOSPITAL_TYPE.test(h.type ?? "")).map((h) => ({
  kind: "hospital", id: `HS-${h.id}`, name: h.name.replace(/_[A-Za-z]+$/, "").trim(), at: h.at, geom: pt(h.at),
  props: { ...statusProps(h), type: h.type ?? "Hospital", ownership: h.ownership || "Not recorded", beds: h.beds ?? 0, major: MAJOR_TYPE.test(h.type ?? "") || GOVERNMENT.test(h.ownership ?? "") },
}));
export const HOSPITALS = ALL_HOSPITALS.filter((h) => h.props.major || atRisk(h));

const LANDSLIDE_NEAR_M = 300;
const dm = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 98600, (a[1] - b[1]) * 110600);

/** Schools: every registered school gets a status; only those at risk go on the map. */
const schoolRows = OPS.schools.map((s) => {
  const slide = OPS.landslides.map((l) => ({ l, d: dm(s.at, l.at) })).sort((a, b) => a.d - b.d)[0];
  const why = [`Road network (modelled)::${s.why}`];
  let risk: "ok" | "risk" | "high" | "none" = s.access === "lost" ? "high" : s.access === "degraded" ? "risk" : s.access === "unknown" ? "none" : "ok";
  if (slide && slide.d <= LANDSLIDE_NEAR_M) { risk = "high"; why.push(`Landslide reports (real, BIPAD)::A verified landslide was reported ${Math.round(slide.d)} m away on ${slide.l.on}.`); }
  return { s, risk, why };
});
export const SCHOOLS_CHECKED = schoolRows.length;
export const SCHOOLS: Entity[] = schoolRows.filter((r) => r.risk === "risk" || r.risk === "high").map(({ s, risk, why }) => ({
  kind: "school", id: `SC-${s.id}`, name: s.name, at: s.at, geom: pt(s.at), props: { ...statusProps(s), risk, why: why.join("|") },
}));

/** IOM-designated humanitarian open spaces only. NSET's community open spaces are left out to keep the map readable. */
export const SHELTERS: Entity[] = OPS.openSpaces.filter((o) => o.source === "IOM").map((o) => ({
  kind: "shelter", id: `OS-${o.id}`, name: o.name, at: o.at, geom: pt(o.at), props: { ...statusProps(o), designated: "IOM humanitarian open space" },
}));

/** Google Places elderly / nursing homes — net-new vs BIPAD; drawn as shelters. */
export const CARE_HOMES: Entity[] = GOOGLE.careHomes.map((p, i) => ({
  kind: "shelter" as const,
  id: `GH-${i + 1}`,
  name: p.name,
  at: p.at,
  geom: pt(p.at),
  props: {
    access: "none", why: "Google Places snapshot — flood road status not modelled yet",
    extraMin: 0, closureM: 0, closure: "",
    designated: "Elderly / nursing care (Google Places)",
    address: p.address ?? "", placeId: p.id, prov: "googlePlaces",
  },
}));

/** Fire engines and police: real bases that response can come from. */
export const RESPONDERS: Entity[] = OPS.responders.map((r) => ({
  kind: "qrt", id: `RB-${r.id}`, name: /^(fire engine|police( station)?)$/i.test(r.name.trim()) || r.name.length <= 3 ? `${r.type} base ${r.id}` : r.name, at: r.at, geom: pt(r.at), props: { ...statusProps(r), unit: r.type },
}));

/** Google fire + police — skip if within ~120 m of an existing BIPAD responder. */
const nearBipad = (at: [number, number]) => RESPONDERS.some((r) => dm(r.at, at) < 120);
export const GOOGLE_RESPONDERS: Entity[] = [
  ...GOOGLE.fireStations.map((p, i) => ({ p, i, unit: "Fire" as const })),
  ...GOOGLE.police.map((p, i) => ({ p, i: i + 1000, unit: "Police" as const })),
].filter(({ p }) => !nearBipad(p.at)).map(({ p, i, unit }) => ({
  kind: "qrt" as const,
  id: `GR-${i + 1}`,
  name: p.name,
  at: p.at,
  geom: pt(p.at),
  props: {
    access: "none", why: "Google Places snapshot — flood road status not modelled yet",
    extraMin: 0, closureM: 0, closure: "",
    unit, address: p.address ?? "", placeId: p.id, prov: "googlePlaces",
  },
}));

export const ARMY: Entity[] = OPS.army.map((a) => ({
  kind: "army", id: `AB-${a.id}`, name: a.name, at: a.at, geom: pt(a.at), props: { ...statusProps(a), role: "Registered Nepal Army site (BIPAD)" },
}));
export const AIRPORTS: Entity[] = OPS.airports.map((a) => ({
  kind: "airport", id: "AP-1", name: a.name, at: a.at, geom: pt(a.at), props: { ...statusProps(a), role: "Main relief hub" },
}));

/** Official alerts, drawn as a 600 m circle at the alert's point. The ward boundary itself is not drawn. */
export const ALERTS: Entity[] = OPS.alerts.map((a) => ({
  kind: "alert", id: `AL-${a.id}`, name: a.title, at: a.at, geom: circle(a.at, 600),
  props: { hazard: a.hazard, issued: a.startedOn, issuedText: hhmm(a.startedOn), verified: a.verified, prov: "record" },
}));

/** River gauges stand in for "dam data": the valley has no dam worth tracking, and these readings are real. */
export const GAUGES: Entity[] = OPS.gauges.map((g) => ({
  kind: "dam", id: `RG-${g.id}`, name: g.name, at: g.at, geom: pt(g.at),
  props: { peak: g.peak, peakAt: hhmm(g.peakAt), warning: g.warningLevel, danger: g.dangerLevel, firstDanger: hhmm(g.firstDanger), lastReading: hhmm(g.lastReading), aboveDanger: g.peak >= g.dangerLevel, prov: "record" },
}));

export const LANDSLIDES: Entity[] = OPS.landslides.map((l) => ({
  kind: "landslide", id: `LS-${l.id}`, name: l.title, at: l.at, geom: circle(l.at, 250),
  props: { risk: "Reported", households: l.families, deaths: l.deaths, injured: l.injured, on: l.on, prov: "record" },
}));

/** Real rain (Open-Meteo, ECMWF IFS 9 km). The slider starts at the heaviest observed 24 h, in inches to match the console. */
export const WEATHER = OPS.weather;
export const OBSERVED_IN = Math.round(WEATHER.max24hMm / 25.4);
export const whenText = (t: string) => `${Number(t.slice(8, 10))} Sep ${t.slice(11, 16)}`;

/** Model grid cells as squares, shaded by the 27–28 Sep total (v: 1 lowest third, 3 highest third). */
const sortedTotals = WEATHER.cells.map((c) => c.total2728Mm).sort((a, b) => a - b);
const third = (v: number) => (v >= sortedTotals[Math.floor((sortedTotals.length * 2) / 3)]! ? 3 : v >= sortedTotals[Math.floor(sortedTotals.length / 3)]! ? 2 : 1);
const HALF_LAT = 0.0352, HALF_LON = 0.05; // half the IFS grid spacing here (about 0.07° lat, 0.1° lon)
export const RAIN_CELLS = {
  type: "FeatureCollection" as const,
  features: WEATHER.cells.map((c) => ({
    type: "Feature" as const, properties: { v: third(c.total2728Mm), total: c.total2728Mm },
    geometry: { type: "Polygon" as const, coordinates: [[[c.at[0] - HALF_LON, c.at[1] - HALF_LAT], [c.at[0] + HALF_LON, c.at[1] - HALF_LAT], [c.at[0] + HALF_LON, c.at[1] + HALF_LAT], [c.at[0] - HALF_LON, c.at[1] + HALF_LAT], [c.at[0] - HALF_LON, c.at[1] - HALF_LAT]]] as [number, number][][] },
  })),
};

/** The outlet gauge, used as the headline river reading in evidence text. */
export const OUTLET = OPS.gauges.find((g) => /khokana/i.test(g.name)) ?? null;

/** Gauge crossings and official alerts on one clock, for the Details timeline. */
export const TIMELINE: { at: string; what: string; src: string }[] = [
  ...OPS.gauges.flatMap((g) => [
    ...(g.firstWarning ? [{ at: g.firstWarning, what: `${g.name} passes its warning level (${g.warningLevel} m)`, src: "DHM gauge" }] : []),
    ...(g.firstDanger ? [{ at: g.firstDanger, what: `${g.name} passes its danger level (${g.dangerLevel} m)`, src: "DHM gauge" }] : []),
  ]),
  ...OPS.alerts.map((a) => ({ at: a.startedOn, what: a.title, src: "Official alert" })),
  { at: OPS.weather.peakAt, what: `Valley rain peaks at ${OPS.weather.peakMmH} mm per hour (valley average)`, src: "Open-Meteo, ECMWF IFS" },
  { at: OPS.weather.max24hEnd, what: `Heaviest 24 h of rain ends: ${OPS.weather.max24hMm} mm (valley average)`, src: "Open-Meteo, ECMWF IFS" },
].filter((x) => x.at >= "2024-09-27" && x.at < "2024-09-29").sort((a, b) => a.at.localeCompare(b.at));
