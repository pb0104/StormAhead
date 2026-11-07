/** DEMO ONLY: invented evidence and recommended actions. Nothing here is a real assessment or a real dispatch. */
import { ENTITIES, OF, type Entity } from "./demo.ts";
import { IODA_REGION, NIGHT, nepalTime, nightCellAt } from "../realdata.ts";

export type Reason = { input: string; text: string };
export type Action = {
  id: string; kind: "qrt" | "food" | "shelter" | "grid" | "alert" | "road" | "air" | "army";
  title: string; detail: string; target?: Entity; alertEn?: string; alertNe?: string;
};

const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
export const distKm = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 98.6, (a[1] - b[1]) * 110.6);
const km = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 98.6, (a[1] - b[1]) * 110.6);
export const nearest = (e: Entity, list: Entity[], n = 1) => [...list].sort((a, b) => km(e.at, a.at) - km(e.at, b.at)).slice(0, n);
const fmt = (n: number) => n.toLocaleString("en-US");
const within = (e: Entity, list: Entity[], d: number) => list.filter((x) => km(e.at, x.at) <= d);
/** Cell sites within d km whose modelled status is down or at risk. */
const hit = (e: Entity, towers: Entity[], d: number) => within(e, towers, d).filter((t) => t.props.status !== "up").length;

export const KIND_LABEL: Record<string, string> = {
  closure: "Closed road", pocket: "Cut-off pocket", landslide: "Landslide zone", hospital: "Hospital", tower: "Cell tower", outage: "Grid outage",
  building: "Building", alert: "Public alert zone", dam: "Dam gauge", social: "Social media post", radio: "Radio call-in", shelter: "Shelter", food: "Food depot", qrt: "QRT staging", school: "School", airport: "Airport or helipad", army: "Army base",
};

export function reasons(e: Entity): Reason[] {
  const h = hash(e.id), hosp = OF("hospital"), towers = OF("tower"), social = OF("social"), radio = OF("radio");
  const rain = 120 + (h % 90), dam = 86 + (h % 12);
  switch (e.kind) {
    case "closure": return [
      { input: "Road network", text: `${e.props.bridge ? "River crossing" : "Road segment"}, ${fmt(e.props.lengthM as number)} m, ${e.props.cls} class.` },
      { input: "Terrain", text: `Low ground, about ${(1.5 + (h % 30) / 10).toFixed(1)} m above the channel.` },
      { input: "Weather", text: `${rain} mm forecast in 24 h upstream.` },
      { input: "Dam", text: `Gauge at ${dam}% and release rising.` },
      { input: "Social media", text: `${2 + (h % 6)} geotagged posts within 400 m mention water on the road.` },
      { input: "Radio", text: `${1 + (h % 3)} call-ins report the crossing impassable.` },
      { input: "Critical buildings", text: within(e, hosp, 3).length ? `${within(e, hosp, 3).length} hospital(s) within 3 km lose their shortest route.` : "No hospital within 3 km depends on this road." },
    ];
    case "pocket": return [
      { input: "Road network", text: `${e.props.segments} open road segments are cut off from the rest of the network.` },
      { input: "Terrain", text: "Closed crossings on both sides of the pocket." },
      { input: "Cell sites", text: `${hit(e, towers, 2)} cell site(s) within 2 km modelled down or at risk from flooding, so reports may be missing.` },
      { input: "Radio", text: "Last call-in from the area 40 minutes ago." },
    ];
    case "landslide": return [
      { input: "Terrain", text: `Steep slope, risk ${e.props.risk}.` },
      { input: "Weather", text: `${rain + 30} mm forecast in 24 h, soil already saturated.` },
      { input: "Radio", text: "Call-in: hillside cracked above the school." },
      { input: "Road network", text: `${1 + (h % 3)} access road(s) pass through the zone.` },
      { input: "Critical buildings", text: `${e.props.households} households below the slope.` },
    ];
    case "hospital": return [
      { input: "Critical buildings", text: e.props.access === "lost" ? "No open route from the valley road network." : e.props.access === "degraded" ? `Ambulance trips take ${e.props.extraMin} min longer.` : "Access normal." },
      { input: "Road network", text: `${within(e, OF("closure"), 2.5).length} closed segment(s) within 2.5 km.` },
      { input: "Cell sites", text: `${hit(e, towers, 1.5)} cell site(s) within 1.5 km modelled down or at risk from flooding.` },
    ];
    case "school": return [
      ...(String(e.props.why).split("|").filter(Boolean).map((t) => { const [input, ...rest] = t.split("::"); return { input: input!, text: rest.join("::") }; })),
      { input: "Critical buildings", text: `About ${fmt(e.props.students as number)} students enrolled.` },
      ...(e.props.risk === "ok" ? [{ input: "Assessment", text: "No cascade risk found nearby in the demo data." }] : []),
    ];
    case "building": {
      const floors = e.props.floors === "" ? null : Number(e.props.floors);
      const depth = Number(e.props.depthM), lost = Number(e.props.floorsLost);
      return [
        { input: "Buildings (REAL, OpenStreetMap 2 Jan 2024)", text: floors === null
          ? `${e.props.type}, ${fmt(e.props.areaM2 as number)} m² footprint. Height is NOT tagged in OpenStreetMap, so no shelter judgement is offered for this building.`
          : `${e.props.type}, ${floors} storey${floors === 1 ? "" : "s"}, ${fmt(e.props.areaM2 as number)} m² footprint.` },
        { input: "Flood depth (terrain + weather agents)", text: depth > 0
          ? `About ${depth.toFixed(1)} m of water here, so the lowest ${lost} floor${lost === 1 ? "" : "s"} ${lost === 1 ? "is" : "are"} unusable.`
          : "No water on this building in the current forecast." },
        ...(floors === null ? [] : [{ input: "Assessment", text: e.props.role === "at-risk-evacuate"
          ? "No floor stays above the water, so people cannot shelter here."
          : e.props.role === "at-risk-vertical" ? `${e.props.usableFloors} floor(s) stay above the water: about ${fmt(e.props.capacity as number)} places at 3.5 m² per person.`
          : e.props.role === "refuge" ? `Dry, and inside an area that has lost road access. ${e.props.usableFloors} usable floor(s), about ${fmt(e.props.capacity as number)} places.`
          : "Dry and still reachable by road." }]),
      ];
    }
    case "airport": return [
      { input: "Road network", text: e.props.access === "ok" ? "Access roads open." : `Closed road ${e.props.closure} is ${e.props.closureM} m away, so ${e.props.access === "lost" ? "road access is cut" : "road access is slowed"}.` },
      { input: "Weather", text: "Low cloud and heavy rain forecast for the next 12 hours." },
      { input: "Role", text: `${e.props.role}.` },
    ];
    case "army": return [
      { input: "Road network", text: e.props.access === "ok" ? "Routes out of the base are open." : `Closed road ${e.props.closure} is ${e.props.closureM} m away, so vehicles may not get out.` },
      { input: "Role", text: `${e.props.role}.` },
    ];
    case "tower": {
      const r = IODA_REGION.series.bgp!, d = e.props.distFloodM as number;
      return [
        { input: "Cell site (REAL, OpenCelliD)", text: `${e.props.cells} cell(s) (${e.props.radios}) from ${e.props.operators}. Position estimated from ${fmt(e.props.samples as number)} phone report(s), so it may be off by a few hundred metres.${e.props.preEvent ? "" : ` First seen in OpenCelliD on ${e.props.firstSeen}, after the flood, so it may not have existed then.`}` },
        { input: "Flood exposure (MODELLED)", text: e.props.status === "down"
          ? "Inside the observed flood extent (UNOSAT, 30 Sep). Ground-level equipment likely flooded, so modelled as down."
          : `${fmt(d)} m from the observed flood extent, so modelled as ${e.props.status === "risk" ? "at risk" : "up"}. Real site status is not public.` },
        { input: "Internet (REAL, IODA)", text: `Across the ${IODA_REGION.label.split(" (")[0]}, networks visible on the internet fell ${r.dropPct}% to their lowest at ${nepalTime(r.floodMinAt)}, Nepal time.` },
        { input: "Power (REAL, NASA night lights)", text: (() => { const c = nightCellAt(e.at[0], e.at[1]); return !c ? "Not in a lit area, so night lights cannot tell." : c.status === "unseen" ? "Cloud hid this area on every night after the flood." : `Lights here were at ${Math.round((c.ratio ?? 0) * 100)}% of normal after the flood${c.status === "dark" ? ", so the site has likely lost grid power and is on batteries." : "."}`; })() },
      ];
    }
    case "outage": return [
      { input: "Night lights (REAL, NASA)", text: `${e.props.cells} cell(s) of about 460 m, ${e.props.areaKm2} km², were at a median ${Math.round((e.props.medianRatio as number) * 100)}% of their normal brightness on clear nights from ${NIGHT.windows.flood![0].slice(5)} to ${NIGHT.windows.flood![1].slice(5)}, against the weeks before the rain. Likely lost power.` },
      { input: "Caveat", text: `28 Sep was fully clouded, so the darkest hours are not seen. Thin cloud can also dim lights. On ordinary nights this rule flags ${(NIGHT.counts.controlFalseDarkRate * 100).toFixed(1)}% of cells.` },
      { input: "Cell sites", text: `${hit(e, towers, 1.2)} cell site(s) within 1.2 km modelled down or at risk, likely on battery power.` },
    ];
    case "alert": return [
      { input: "Weather", text: "Heavy rain and rising river levels in this zone." },
      { input: "Road network", text: `${within(e, OF("closure"), 2.5).length} closed segment(s) inside or near the zone.` },
      { input: "Dam", text: `Release rising, gauge A at ${(OF("dam")[0]?.props.level as number) ?? 90}%.` },
    ];
    case "dam": return [
      { input: "Dam", text: `Reservoir at ${e.props.level}%. Release scheduled to rise in 3 h.` },
      { input: "Weather", text: "Heavy rain upstream." },
    ];
    case "social": return [{ input: "Social media", text: `${e.props.text} (${e.props.when})` }];
    case "radio": return [{ input: "Radio", text: `${e.props.text} (${e.props.when})` }];
    default: return [];
  }
}

export function actions(e: Entity): Action[] {
  const h = hash(e.id), qrt = OF("qrt"), food = OF("food"), shelters = OF("shelter"), outages = OF("outage"), alerts = OF("alert");
  const a: Action[] = [];
  const evac = (label: string, n: number) => {
    const t = nearest(e, qrt)[0]!;
    a.push({ id: `${e.id}:qrt`, kind: "qrt", title: `Send ${t.id} to evacuate ${label}`, detail: `About ${fmt(n)} people. Team is ${km(e.at, t.at).toFixed(1)} km away. Use the alternate route.`, target: t });
  };
  const feed = (n: number) => { const t = nearest(e, food)[0]!; a.push({ id: `${e.id}:food`, kind: "food", title: `Stage ${fmt(n)} meal packs from ${t.name.replace("Food depot, ", "")} depot`, detail: `${t.id} holds ${fmt(t.props.packs as number)} packs.`, target: t }); };
  const shelter = () => { const t = [...shelters].filter((s) => (s.props.capacity as number) - (s.props.occupied as number) > 80).sort((x, y) => km(e.at, x.at) - km(e.at, y.at))[0]!; a.push({ id: `${e.id}:shelter`, kind: "shelter", title: `Open ${t.name}`, detail: `${fmt((t.props.capacity as number) - (t.props.occupied as number))} free places, ${km(e.at, t.at).toFixed(1)} km away.`, target: t }); };
  const grid = () => { const t = nearest(e, outages)[0]!; a.push({ id: `${e.id}:grid`, kind: "grid", title: `Send a grid crew to ${t.name.replace("Dark area near ", "")}`, detail: `${t.props.areaKm2} km² went dark after the flood (NASA night lights). Prioritise the hospital feeder.`, target: t }); };
  const alert = (label?: string) => {
    const z = (label ? alerts.find((x) => x.id === label) : nearest(e, alerts)[0]) ?? alerts[0]!;
    a.push({ id: `${e.id}:alert`, kind: "alert", title: `Public alert for ${z.name}`, detail: `Reaches about ${fmt(z.props.audience as number)} people. Preview before issuing.`, target: z,
      alertEn: "Flood warning: the river is rising. Move away from the river bank and low roads now and go to the nearest shelter. Do not cross flooded roads.",
      alertNe: "बाढीको चेतावनी: नदीको सतह बढ्दै छ। अहिले नै नदी किनार र होचो सडकबाट टाढा जानुहोस् र नजिकको आश्रयस्थलमा पुग्नुहोस्। बाढी आएको सडक पार नगर्नुहोस्।" });
  };
  const armyReq = (what: string, detail: string) => { const t = nearest(e, OF("army"))[0]!; a.push({ id: `${e.id}:army`, kind: "army", title: `Ask ${t.id} for ${what}`, detail: `${detail} Base is ${km(e.at, t.at).toFixed(1)} km away.`, target: t }); };
  const airlift = () => { const t = nearest(e, OF("airport").filter((x) => x.props.access !== "lost"))[0]; if (t) a.push({ id: `${e.id}:air`, kind: "air", title: `Airlift from ${t.name}`, detail: `${t.props.role}. ${km(e.at, t.at).toFixed(1)} km away. Needs a clear landing zone.`, target: t }); };
  switch (e.kind) {
    case "closure": armyReq("engineers to bridge or clear the crossing", "Estimated 8 to 14 hours."); evac("the cut-off side", 120 + (h % 380)); feed(800 + (h % 9) * 100); shelter(); if (within(e, outages, 3).length) grid(); alert(); break;
    case "pocket": armyReq("boats and trucks", "Use for people the QRT cannot reach on foot."); airlift(); evac("the pocket", 80 + (h % 260)); feed(600 + (h % 7) * 100); shelter(); break;
    case "landslide": evac("households below the slope", (e.props.households as number) * 4); a.push({ id: `${e.id}:road`, kind: "road", title: "Close the access road below the slope", detail: "Advise traffic to use the ring road. Post a marshal at the junction." }); shelter(); alert(); break;
    case "hospital": evac("patients and staff if the route fails", 60 + (h % 80)); a.push({ id: `${e.id}:road`, kind: "road", title: "Hold an ambulance and escort at the alternate route", detail: `Adds ${e.props.access === "ok" ? "no delay" : "about " + (e.props.extraMin || 25) + " min"} but keeps the hospital reachable.` }); grid(); break;
    case "school":
      if (e.props.risk !== "ok") {
        evac("students and staff", e.props.students as number);
        a.push({ id: `${e.id}:road`, kind: "road", title: "Hold students on site and stop buses on the route", detail: "Keep children in the school until the road reopens or QRT arrives. Tell parents not to travel." });
        shelter(); alert();
      }
      break;
    case "airport":
      a.push({ id: `${e.id}:air`, kind: "air", title: `Hold ${e.name} for relief flights`, detail: `${e.props.role}. Clear the apron and keep the fuel truck on standby.`, target: e });
      feed(1500 + (h % 6) * 100);
      if (e.props.access !== "ok") armyReq("engineers to reopen the access road", `Closed road ${e.props.closure} cuts the approach.`);
      break;
    case "army":
      a.push({ id: `${e.id}:army`, kind: "army", title: `Request ${e.name.split(",")[1]?.trim() ?? "support"}`, detail: `${e.props.role}.${e.props.access === "ok" ? "" : " Routes out are limited, so pre-position early."}`, target: e });
      break;
    case "building": {
      const cap = Number(e.props.capacity) || 0;
      if (e.props.role === "at-risk-evacuate") { evac(`everyone in ${e.name}`, Math.max(20, Math.round((e.props.areaM2 as number) / 12))); shelter(); alert(); }
      else if (e.props.role === "at-risk-vertical") {
        a.push({ id: `${e.id}:road`, kind: "road", title: `Move people to the upper floors of ${e.name}`, detail: `${e.props.usableFloors} floor(s) stay above about ${Number(e.props.depthM).toFixed(1)} m of water: room for about ${fmt(cap)}. Send water and light, not transport.` });
        armyReq("boats to reach the upper floors", "Ground floor is under water."); feed(cap);
      } else if (e.props.role === "refuge") {
        a.push({ id: `${e.id}:shelter`, kind: "shelter", title: `Open ${e.name} as a local refuge`, detail: `Dry, ${e.props.usableFloors} usable floor(s), about ${fmt(cap)} places. The area has lost road access, so shelter people here rather than moving them out.`, target: e });
        feed(cap);
      }
      break;
    }
    case "tower": grid(); break;
    case "outage": grid(); alert(); break;
    case "alert": alert(e.id); shelter(); break;
    default: break;
  }
  return a;
}

export const nearestOf = nearest;
export const allEntities = ENTITIES;
