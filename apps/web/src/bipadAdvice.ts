/**
 * Evidence and recommended actions for the BIPAD-backed ops console.
 * Real records: BIPAD/DHM. Statuses modelled from the observed flood. Towers/outages/posts/radio/food are simulated.
 */
import type { Action, Entity, Reason } from "../../../packages/ports/index.ts";
import { OUTLET } from "./real/ops.ts";

const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const km = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 98.6, (a[1] - b[1]) * 110.6);
const nearest = (e: Entity, list: Entity[], n = 1) => [...list].sort((a, b) => km(e.at, a.at) - km(e.at, b.at)).slice(0, n);
const fmt = (n: number) => n.toLocaleString("en-US");
const within = (e: Entity, list: Entity[], d: number) => list.filter((x) => km(e.at, x.at) <= d);
const of = (all: Entity[], k: string) => all.filter((e) => e.kind === k);

export function bipadAdvice(e: Entity, all: Entity[]): { reasons: Reason[]; actions: Action[] } {
  return { reasons: reasons(e, all), actions: actions(e, all) };
}

function reasons(e: Entity, all: Entity[]): Reason[] {
  const h = hash(e.id), hosp = of(all, "hospital"), towers = of(all, "tower");
  const river = OUTLET ? [{ input: "Rivers (real, DHM)", text: `${OUTLET.name} peaked at ${OUTLET.peak} m on 28 Sep, against a danger level of ${OUTLET.dangerLevel} m.` }] : [];
  const closedNear = (d: number) => `${within(e, of(all, "closure"), d).length} of the closed roads shown are within ${d} km.`;
  switch (e.kind) {
    case "closure": return [
      { input: "Road network (modelled)", text: `${e.props.bridge ? "River crossing" : "Road segment"}, ${fmt(e.props.lengthM as number)} m, ${e.props.cls} class. Closed by the rule: a bridge touching the flood, or 30% or more of the road under water.` },
      { input: "Flood (real, UNOSAT)", text: "Touches the flood extent observed on 30 Sep 2024." },
      ...river,
      { input: "Critical buildings", text: within(e, hosp, 3).length ? `${within(e, hosp, 3).length} hospital(s) shown within 3 km. Each hospital's own access status is modelled separately.` : "No hospital shown within 3 km." },
      { input: "Social media (simulated)", text: `${2 + (h % 6)} geotagged posts within 400 m mention water on the road.` },
      { input: "Radio (simulated)", text: `${1 + (h % 3)} call-ins report the crossing impassable.` },
    ];
    case "pocket": return [
      { input: "Road network (modelled)", text: `${e.props.segments} open road segments are cut off from the rest of the network by closed crossings.` },
      { input: "Cell towers (simulated)", text: `${within(e, towers, 2).filter((t) => t.props.status === "down").length} nearby tower(s) down, so reports may be missing.` },
      { input: "Radio (simulated)", text: "Last call-in from the area 40 minutes ago." },
    ];
    case "landslide": return [
      { input: "Landslide report (real, BIPAD)", text: `Verified report on ${e.props.on}: ${e.props.deaths} death(s), ${e.props.injured} injured, ${e.props.households} families affected.` },
      { input: "Road network (modelled)", text: closedNear(1.5) },
      ...river,
    ];
    case "hospital": return [
      { input: "Hospital registry (real, BIPAD)", text: `${e.props.type}${e.props.ownership ? `, ${e.props.ownership}` : ""}${e.props.beds ? `, ${fmt(e.props.beds as number)} beds` : ""}.` },
      { input: "Access (modelled)", text: e.props.access === "lost" ? "No open road route from central Kathmandu under the observed flood." : e.props.access === "degraded" ? `Detours add about ${e.props.extraMin} min from central Kathmandu.` : e.props.access === "none" ? "Height / network status unknown; no access judgement." : "Access normal under the observed flood." },
      { input: "Road network (modelled)", text: e.props.closure ? `Nearest closed road ${e.props.closure}, about ${fmt(e.props.closureM as number)} m away.` : closedNear(2.5) },
    ];
    case "school": return [
      ...(String(e.props.why).split("|").filter(Boolean).map((t) => { const [input, ...rest] = t.split("::"); return { input: input!, text: rest.join("::") }; })),
      { input: "Access (modelled)", text: e.props.access === "lost" ? "Road access lost under the observed flood." : e.props.access === "degraded" ? `Detours add about ${e.props.extraMin} min.` : "Reachable by road under the observed flood." },
    ];
    case "airport": return [
      { input: "Airport (real, BIPAD)", text: `${e.props.role}.` },
      { input: "Access (modelled)", text: e.props.access === "ok" ? "Access roads open under the observed flood." : `Closed road ${e.props.closure} is ${e.props.closureM} m away, so ${e.props.access === "lost" ? "road access is cut" : "road access is slowed"}.` },
      ...river,
    ];
    case "army": return [
      { input: "Army site (real, BIPAD)", text: `${e.props.role}.` },
      { input: "Access (modelled)", text: e.props.access === "ok" ? "Routes out are open under the observed flood." : `Closed road ${e.props.closure} is ${e.props.closureM} m away.` },
    ];
    case "shelter": return [
      { input: "Open space (real, IOM via BIPAD)", text: `${e.props.designated}.` },
      { input: "Access (modelled)", text: e.props.access === "ok" ? "Reachable by road under the observed flood." : e.props.access === "degraded" ? `Detours add about ${e.props.extraMin} min.` : "Road access lost under the observed flood." },
    ];
    case "qrt": return [
      { input: "Responder base (real, BIPAD)", text: `${e.props.unit} base.` },
      { input: "Access (modelled)", text: e.props.access === "ok" ? "Can deploy by road." : e.props.access === "degraded" ? `Detours add about ${e.props.extraMin} min.` : "Road access lost; redeploy from another base." },
    ];
    case "tower": return [
      { input: "Cell towers (simulated)", text: e.props.status === "down" ? "Offline since 21:40." : "Online, normal load." },
      { input: "Grid (simulated)", text: e.props.status === "down" ? "Power lost at the site, backup battery exhausted." : "On grid power." },
    ];
    case "outage": return [
      { input: "Grid (simulated)", text: `${fmt(e.props.households as number)} households without power.` },
      { input: "Cell towers (simulated)", text: `${within(e, towers, 1.8).filter((t) => t.props.status === "down").length} tower(s) in the zone are down.` },
    ];
    case "alert": return [
      { input: "Official alert (real, BIPAD)", text: `${e.props.hazard} alert issued ${e.props.issuedText} 2024${e.props.verified ? ", verified" : ""}. The circle marks the alert point, not the ward boundary.` },
      { input: "Road network (modelled)", text: closedNear(2.5) },
      ...river,
    ];
    case "dam": return [
      { input: "River gauge (real, DHM)", text: `Peaked at ${e.props.peak} m (${e.props.peakAt}). Warning ${e.props.warning} m, danger ${e.props.danger} m.` },
      { input: "Status", text: e.props.aboveDanger ? `Above danger from ${e.props.firstDanger}.` : "Stayed below its danger level." },
      { input: "Data", text: `Last reading in the window: ${e.props.lastReading}.` },
    ];
    case "social": return [{ input: "Social media (simulated)", text: `${e.props.text} (${e.props.when})` }];
    case "radio": return [{ input: "Radio (simulated)", text: `${e.props.text} (${e.props.when})` }];
    case "helipad": return [
      { input: "Helipad (OpenStreetMap)", text: "Mapped helipad; status not in BIPAD." },
      { input: "Access (demo)", text: e.props.access === "ok" ? "Access assumed open." : `Access ${e.props.access}.` },
    ];
    case "food": return [
      { input: "Food depot (simulated)", text: `${fmt(e.props.packs as number)} meal packs on hand. No public stock feed was found.` },
    ];
    default: return [];
  }
}

function actions(e: Entity, all: Entity[]): Action[] {
  const h = hash(e.id), qrt = of(all, "qrt"), food = of(all, "food"), shelters = of(all, "shelter"), outages = of(all, "outage"), alerts = of(all, "alert");
  const a: Action[] = [];
  const evac = (label: string, n: number | null) => {
    const t = nearest(e, qrt.filter((x) => x.props.access !== "lost"))[0]; if (!t) return;
    a.push({ id: `${e.id}:qrt`, kind: "qrt", title: `Send a team from ${t.name} to evacuate ${label}`, detail: `${n ? `About ${fmt(n)} people. ` : ""}${t.props.unit} base, ${km(e.at, t.at).toFixed(1)} km away. Use the alternate route.`, targetId: t.id });
  };
  const feed = (n: number) => {
    const t = nearest(e, food)[0]; if (!t) return;
    a.push({ id: `${e.id}:food`, kind: "food", title: `Stage ${fmt(n)} meal packs from ${String(t.name).replace("Food depot, ", "")} depot (simulated)`, detail: `${t.id} holds ${fmt(t.props.packs as number)} packs. Depots and stock are simulated.`, targetId: t.id });
  };
  const shelter = () => {
    const t = nearest(e, shelters.filter((x) => x.props.access === "ok" || x.props.access === "degraded"))[0];
    if (t) a.push({ id: `${e.id}:shelter`, kind: "shelter", title: `Open ${t.name} as a gathering point`, detail: `IOM-designated open space, ${km(e.at, t.at).toFixed(1)} km away and reachable by road (modelled). Capacity is not in the public record.`, targetId: t.id });
  };
  const grid = () => {
    const t = nearest(e, outages)[0]; if (!t) return;
    a.push({ id: `${e.id}:grid`, kind: "grid", title: `Send a grid crew to ${t.name}`, detail: `About ${fmt(t.props.households as number)} households. Prioritise the hospital feeder.`, targetId: t.id });
  };
  const alert = (label?: string) => {
    const z = (label ? alerts.find((x) => x.id === label) : nearest(e, alerts)[0]) ?? alerts[0];
    if (!z) return;
    a.push({
      id: `${e.id}:alert`, kind: "alert", title: `Follow-up public alert near ${z.name.replace(/^.* at /, "")}`,
      detail: `An official ${String(z.props.hazard).toLowerCase()} alert was issued here at ${z.props.issuedText}. Preview before issuing.`, targetId: z.id,
      alertEn: "Flood warning: the river is rising. Move away from the river bank and low roads now and go to the nearest shelter. Do not cross flooded roads.",
      alertNe: "बाढीको चेतावनी: नदीको सतह बढ्दै छ। अहिले नै नदी किनार र होचो सडकबाट टाढा जानुहोस् र नजिकको आश्रयस्थलमा पुग्नुहोस्। बाढी आएको सडक पार नगर्नुहोस्।",
    });
  };
  const armyReq = (what: string, detail: string) => {
    const t = nearest(e, of(all, "army"))[0]; if (!t) return;
    a.push({ id: `${e.id}:army`, kind: "army", title: `Ask ${t.name} for ${what}`, detail: `${detail} Site is ${km(e.at, t.at).toFixed(1)} km away.`, targetId: t.id });
  };
  const airlift = () => {
    const t = nearest(e, [...of(all, "airport"), ...of(all, "helipad")].filter((x) => x.props.access !== "lost"))[0];
    if (t) a.push({ id: `${e.id}:air`, kind: "air", title: `Airlift from ${t.name}`, detail: `${t.props.role ?? "Relief pad"}. ${km(e.at, t.at).toFixed(1)} km away. Needs a clear landing zone.`, targetId: t.id });
  };
  switch (e.kind) {
    case "closure": armyReq("engineers to bridge or clear the crossing", "Repair time is not modelled."); evac("the cut-off side", null); feed(800 + (h % 9) * 100); shelter(); if (within(e, outages, 3).length) grid(); alert(); break;
    case "pocket": armyReq("boats and trucks", "Use for people responders cannot reach on foot."); airlift(); evac("the pocket", null); feed(600 + (h % 7) * 100); shelter(); break;
    case "landslide": evac("households near the slide", (e.props.households as number) * 4 || null); a.push({ id: `${e.id}:road`, kind: "road", title: "Close the access road below the slope", detail: "Advise traffic to use the ring road. Post a marshal at the junction." }); shelter(); alert(); break;
    case "hospital":
      evac("patients and staff if the route fails", null);
      a.push(e.props.access === "lost"
        ? { id: `${e.id}:road`, kind: "road", title: "Plan patient transfer without road access", detail: "No open road route under the observed flood (modelled). Arrange boats or an airlift, and divert ambulances to the nearest reachable hospital." }
        : { id: `${e.id}:road`, kind: "road", title: "Hold an ambulance and escort at the alternate route", detail: e.props.access === "degraded" ? `Detours add about ${e.props.extraMin} min (modelled) but keep the hospital reachable.` : "Access is normal under the observed flood (modelled). Keep the route under watch." });
      grid();
      break;
    case "school":
      if (e.props.risk !== "ok" && e.props.risk !== "none") {
        evac("students and staff", null);
        a.push({ id: `${e.id}:road`, kind: "road", title: "Hold students on site and stop buses on the route", detail: "Keep children in the school until the road reopens or a response team arrives. Tell parents not to travel." });
        shelter(); alert();
      }
      break;
    case "airport":
      a.push({ id: `${e.id}:air`, kind: "air", title: `Hold ${e.name} for relief flights`, detail: `${e.props.role}. Clear the apron and keep the fuel truck on standby.`, targetId: e.id });
      feed(1500 + (h % 6) * 100);
      if (e.props.access !== "ok") armyReq("engineers to reopen the access road", `Closed road ${e.props.closure} cuts the approach.`);
      break;
    case "army":
      a.push({ id: `${e.id}:army`, kind: "army", title: `Request support from ${e.name}`, detail: `${e.props.role}.${e.props.access === "ok" ? "" : " Routes out are limited, so pre-position early."}`, targetId: e.id });
      break;
    case "shelter":
      if (e.props.access !== "lost") a.push({ id: `${e.id}:shelter`, kind: "shelter", title: `Open ${e.name} as a gathering point`, detail: "IOM-designated open space. Capacity is not in the public record.", targetId: e.id });
      break;
    case "qrt":
      a.push({ id: `${e.id}:qrt`, kind: "qrt", title: `Stage from ${e.name}`, detail: `${e.props.unit} base. ${e.props.access === "ok" ? "Ready to deploy by road." : "Check alternate routes before deploying."}`, targetId: e.id });
      break;
    case "tower": grid(); break;
    case "outage": grid(); alert(); break;
    case "alert": alert(e.id); shelter(); break;
    default: break;
  }
  return a;
}
