// Fetch verified BIPAD incidents for the Kathmandu-valley analysis extent and event window.
// Output: data/real/kathmandu/incidents.json  (evaluation-only data — never an input to the impact model)
import { writeFileSync } from "node:fs";
const H = { "User-Agent": "CascadeIQ-research-prototype/0.1" };
const BBOX = [85.284, 27.587, 85.493, 27.788]; // = UNOSAT SPOT-6 analysis extent
const FROM = "2024-09-26", TO = "2024-10-06";
// Hazard codes from /api/v1/hazard/. Fire (10) etc. are excluded as unrelated to flooding.
const FLOOD_RELATED = { 11: "Flood", 14: "Heavy Rainfall", 17: "Landslide", 28: "Inundation", 5: "Bridge Collapse", 29: "Soil Erosion", 19: "Rainfall" };

let url = `https://bipadportal.gov.np/api/v1/incident/?format=json&limit=500&expand=loss&incident_on__gt=${FROM}&incident_on__lt=${TO}`;
const all = [];
for (let pages = 0; url && pages < 30; pages++) {
  const j = await (await fetch(url, { headers: H, signal: AbortSignal.timeout(90000) })).json();
  all.push(...j.results);
  url = j.next;
}
const inBox = (p) => p?.coordinates && p.coordinates[0] >= BBOX[0] && p.coordinates[0] <= BBOX[2] && p.coordinates[1] >= BBOX[1] && p.coordinates[1] <= BBOX[3];
const L = (l, k) => Number(l?.[k] ?? 0) || 0;
const incidents = all.filter((x) => inBox(x.point) && x.verified).map((x) => {
  const l = x.loss ?? {};
  const loss = {
    deaths: L(l, "peopleDeathCount"), missing: L(l, "peopleMissingCount"), injured: L(l, "peopleInjuredCount"), peopleAffected: L(l, "peopleAffectedCount"),
    familiesAffected: L(l, "familyAffectedCount"), housesDestroyed: L(l, "infrastructureDestroyedHouseCount"), housesAffected: L(l, "infrastructureAffectedHouseCount"),
    roadsDestroyed: L(l, "infrastructureDestroyedRoadCount"), roadsAffected: L(l, "infrastructureAffectedRoadCount"),
    bridgesDestroyed: L(l, "infrastructureDestroyedBridgeCount"), bridgesAffected: L(l, "infrastructureAffectedBridgeCount"),
    electricityDestroyed: L(l, "infrastructureDestroyedElectricityCount"), electricityAffected: L(l, "infrastructureAffectedElectricityCount"),
  };
  return {
    id: x.id, title: x.title, incidentOn: x.incidentOn, reportedOn: x.reportedOn, lon: x.point.coordinates[0], lat: x.point.coordinates[1],
    hazardCode: x.hazard, hazard: FLOOD_RELATED[x.hazard] ?? `code ${x.hazard}`, floodRelated: x.hazard in FLOOD_RELATED,
    verified: x.verified, hasImpact: Object.values(loss).some((v) => v > 0), loss,
  };
});
writeFileSync("data/real/kathmandu/incidents.json", JSON.stringify({
  source: "BIPAD Portal incident API (bipadportal.gov.np/api/v1/incident/)", retrievedAt: new Date().toISOString(), window: [FROM, TO], bbox: BBOX,
  nationalIncidentsInWindow: all.length, note: "Reported, verified incidents; ward-level points. Absence of a report is not absence of impact. Licence not stated on the API — confirm before redistribution.",
  incidents,
}, null, 1));
const fr = incidents.filter((i) => i.floodRelated);
console.log({ national: all.length, inValleyVerified: incidents.length, floodRelated: fr.length, withImpact: fr.filter((i) => i.hasImpact).length,
  byHazard: Object.fromEntries(Object.entries(incidents.reduce((a, i) => ((a[i.hazard] = (a[i.hazard] || 0) + 1), a), {}))) });
