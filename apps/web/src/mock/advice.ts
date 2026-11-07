/** DEMO ONLY: invented evidence and recommended actions. Nothing here is a real assessment or a real dispatch. */
import { ENTITIES, OF, type Entity } from "./demo.ts";

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

export const KIND_LABEL: Record<string, string> = {
  closure: "Closed road", pocket: "Cut-off pocket", landslide: "Landslide zone", hospital: "Hospital", tower: "Cell tower", outage: "Grid outage",
  alert: "Public alert zone", dam: "Dam gauge", social: "Social media post", radio: "Radio call-in", shelter: "Shelter", food: "Food depot", qrt: "QRT staging", school: "School", airport: "Airport or helipad", army: "Army base",
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
      { input: "Cell towers", text: `${within(e, towers, 2).filter((t) => t.props.status === "down").length} nearby tower(s) down, so reports may be missing.` },
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
      { input: "Cell towers", text: `${within(e, towers, 1.5).filter((t) => t.props.status === "down").length} tower(s) near the site are down.` },
    ];
    case "school": return [
      ...(String(e.props.why).split("|").filter(Boolean).map((t) => { const [input, ...rest] = t.split("::"); return { input: input!, text: rest.join("::") }; })),
      { input: "Critical buildings", text: `About ${fmt(e.props.students as number)} students enrolled.` },
      ...(e.props.risk === "ok" ? [{ input: "Assessment", text: "No cascade risk found nearby in the demo data." }] : []),
    ];
    case "airport": return [
      { input: "Road network", text: e.props.access === "ok" ? "Access roads open." : `Closed road ${e.props.closure} is ${e.props.closureM} m away, so ${e.props.access === "lost" ? "road access is cut" : "road access is slowed"}.` },
      { input: "Weather", text: "Low cloud and heavy rain forecast for the next 12 hours." },
      { input: "Role", text: `${e.props.role}.` },
    ];
    case "army": return [
      { input: "Road network", text: e.props.access === "ok" ? "Routes out of the base are open." : `Closed road ${e.props.closure} is ${e.props.closureM} m away, so vehicles may not get out.` },
      { input: "Role", text: `${e.props.role}.` },
    ];
    case "tower": return [
      { input: "Cell towers", text: e.props.status === "down" ? "Offline since 21:40." : "Online, normal load." },
      { input: "Grid", text: e.props.status === "down" ? "Power lost at the site, backup battery exhausted." : "On grid power." },
    ];
    case "outage": return [
      { input: "Grid", text: `${fmt(e.props.households as number)} households without power.` },
      { input: "Terrain", text: "Substation in low ground near the river." },
      { input: "Cell towers", text: `${within(e, towers, 1.8).filter((t) => t.props.status === "down").length} tower(s) in the zone are down.` },
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
  const grid = () => { const t = nearest(e, outages)[0]!; a.push({ id: `${e.id}:grid`, kind: "grid", title: `Send a grid crew to ${t.name}`, detail: `About ${fmt(t.props.households as number)} households. Prioritise the hospital feeder.`, target: t }); };
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
    case "tower": grid(); break;
    case "outage": grid(); alert(); break;
    case "alert": alert(e.id); shelter(); break;
    default: break;
  }
  return a;
}

export const nearestOf = nearest;
export const allEntities = ENTITIES;
