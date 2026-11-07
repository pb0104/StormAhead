// Fetch NCDOT TIMS Hurricane Helene incident records (public ArcGIS FeatureServer) into data/real/helene/tims.json.
// These are REAL reports (replay data + evaluation ground truth). Times are kept as ISO strings.
import { writeFileSync } from "node:fs";
const H = { "User-Agent": "StormAhead-research-prototype/0.1" };
const BASE = "https://services.arcgis.com/NuWFvHYDMVmmxMeM/arcgis/rest/services/State_Maintained_Historical_TIMS_Incidents_Hurricane_Helene/FeatureServer/0/query";
const WINDOW = [Date.parse("2024-09-24T00:00:00Z"), Date.parse("2024-10-08T00:00:00Z")]; // replay window (by incident start)
const rows = [];
for (let off = 0; off < 5000; off += 1000) {
  const r = await (await fetch(`${BASE}?where=1%3D1&outFields=*&returnGeometry=false&resultOffset=${off}&resultRecordCount=1000&f=json`, { headers: H, signal: AbortSignal.timeout(90000) })).json();
  const f = r.features ?? []; rows.push(...f.map((x) => x.attributes)); if (f.length < 1000) break;
}
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const recs = rows.filter((x) => x.StartDateTime >= WINDOW[0] && x.StartDateTime < WINDOW[1] && x.Latitude && x.Longitude).map((x) => ({
  id: x.Id, road: (x.Road ?? "").trim(), commonName: x.CommonName || null, county: x.CountyName, division: x.Division, routeType: x.RouteType,
  condition: x.Condition, lanesAffected: x.LanesAffected, eventType: x.EventType, reason: (x.Reason ?? "").trim(), detour: x.Detour || null, location: x.Location || null,
  lat: x.Latitude, lon: x.Longitude, start: iso(x.StartDateTime), end: iso(x.EndDateTime), lastUpdate: iso(x.LastUpdateDateTime), createdAt: iso(x.CreationDate), createdBy: x.Creator || null,
}));
const by = (f) => Object.entries(recs.reduce((m, r) => ((m[f(r)] = (m[f(r)] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
writeFileSync("data/real/helene/tims.json", JSON.stringify({
  source: "NCDOT TIMS — State Maintained Historical TIMS Incidents, Hurricane Helene (ArcGIS FeatureServer)", retrievedAt: new Date().toISOString(),
  window: WINDOW.map(iso), totalRowsInService: rows.length,
  disclaimer: "NCDOT shall not be held liable for any errors in this data. Points (not lines); state-maintained roads only; completeness unknown.",
  records: recs,
}, null, 1));
console.log({ total: rows.length, inWindow: recs.length, condition: by((r) => r.condition), eventType: by((r) => r.eventType).slice(0, 6), maxEnd: recs.map((r) => r.end).filter(Boolean).sort().at(-1) });
