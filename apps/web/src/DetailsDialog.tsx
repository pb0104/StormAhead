import { useState } from "react";
import { OPS, SCHOOLS_CHECKED, TIMELINE } from "./real/ops.ts";
import type { Done } from "./ContextDrawer.tsx";

const SOURCES: [string, string, string][] = [
  ["Road geometry", "Real", "OpenStreetMap via Geofabrik, 2 Jan 2024 (ODbL)"],
  ["Flood extent", "Real", "UNOSAT SPOT-6 observed flood, 30 Sep 2024 (CC BY-SA)"],
  ["Hospitals", "Real", `${OPS.hospitals.length} registered in the valley (BIPAD). Map shows government and teaching hospitals plus any that lose access`],
  ["Schools", "Real", `${SCHOOLS_CHECKED} registered schools checked (BIPAD). Map shows only those at risk`],
  ["Open spaces", "Real", "IOM-designated humanitarian open spaces (BIPAD)"],
  ["Fire, police and army sites", "Real", "Registered government sites (BIPAD)"],
  ["Helipads", "Real (OSM)", "OpenStreetMap helipads kept alongside BIPAD airport"],
  ["Official alerts", "Real", `${OPS.alerts.length} alerts in the valley, 20 Sep to 5 Oct 2024 (BIPAD)`],
  ["River gauges", "Real", `${OPS.gauges.length} DHM gauges with official warning and danger levels (via BIPAD)`],
  ["Landslides", "Real", `${OPS.landslides.length} verified landslide reports, 26 Sep to 6 Oct 2024 (BIPAD)`],
  ["Facility status", "Modelled", "Closure rule on the real road network under the observed flood. Access is the road trip from central Kathmandu"],
  ["Road closures and cut-off pockets", "Modelled", `From the same engine (${OPS.closedSegments} segments close). The map shows a selection`],
  ["Terrain agent: elevation", "Real", "Public elevation tiles (AWS Terrain Tiles). Used to rank flood patches; absolute depth is an assumption"],
  ["Flood depth and runoff", "Illustrative", "Depth scales with the rain you set. Not a hydraulic simulation"],
  ["Weather agent and rain grid", "Real", `Open-Meteo historical weather API, ECMWF IFS 9 km (CC BY 4.0): ${OPS.weather.total2728Mm} mm valley average on 27–28 Sep 2024. The slider is a what-if on top`],
  ["Atmosphere", "Real", "Open-Meteo cloud cover and MSL pressure (live / cached)"],
  ["Building footprints", "Real", "OSM shelter-relevant footprints for evacuate / shelter-in-place reading"],
  ["Cell towers and outages", "Simulated", "No public feed for tower or grid status"],
  ["Social media", "Real", "Reddit (r/Nepal, r/Kathmandu) via Arctic Shift, 25 Sep to 3 Oct 2024, flood-related only. Places matched by name (GeoNames); tags are a keyword baseline on HumAID categories"],
  ["Radio", "Simulated", "Invented call-ins"],
  ["Food depots", "Simulated", "No public stock feed found"],
];
const ACTIVITY = [
  `Facilities agent: ${OPS.hospitals.length} hospitals, ${SCHOOLS_CHECKED} schools, ${OPS.openSpaces.length} open spaces and ${OPS.responders.length} fire and police bases loaded (real, BIPAD).`,
  `Cascade agent: ${OPS.closedSegments} road segments close under the observed flood; facility access modelled (real roads).`,
  `Hydrology agent: ${OPS.gauges.filter((g) => g.peak >= g.dangerLevel).length} of ${OPS.gauges.length} river gauges passed danger on 27–28 Sep (real, DHM).`,
  `Alerts agent: ${OPS.alerts.length} official alerts loaded (real, BIPAD).`,
  `Weather agent: heaviest 24 h ${OPS.weather.max24hMm} mm valley average; peak ${OPS.weather.peakMmH} mm/h (real, Open-Meteo ECMWF IFS).`,
  "Response agent: options drafted per selection. Food depots, towers and outages are simulated.",
];

export function DetailsDialog({ open, onClose, done, agentLines, note }: { open: boolean; onClose: () => void; done: Done; agentLines: string[]; note?: string }) {
  const [tab, setTab] = useState<"sources" | "timeline" | "assumptions" | "activity">("sources");
  if (!open) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Details" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="d-head"><h2>Details</h2><button className="icon" onClick={onClose} aria-label="Close">×</button></header>
        <div className="tabs" role="tablist">
          {(["sources", "timeline", "assumptions", "activity"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>)}
        </div>
        {tab === "sources" && (
          <table><thead><tr><th>Layer</th><th>Status</th><th>Source</th></tr></thead>
            <tbody>{SOURCES.map(([a, b, c]) => <tr key={a}><td>{a}</td><td><span className={`pill ${b.toLowerCase().startsWith("real") ? "real" : b.toLowerCase().startsWith("model") ? "modelled" : b.toLowerCase().startsWith("sim") ? "simulated" : b.toLowerCase().startsWith("ill") ? "illustrative" : "mixed"}`}>{b}</span></td><td>{c}</td></tr>)}</tbody></table>
        )}
        {tab === "timeline" && (
          <>
            <p className="muted">27–28 Sep 2024, local time. Rain, river gauges and official alerts on one clock, all real.</p>
            <ol className="timeline">{TIMELINE.map((t, i) => <li key={i}><time>{t.at.slice(8, 10)} Sep {t.at.slice(11, 16)}</time><span>{t.what}<small>{t.src}</small></span></li>)}</ol>
          </>
        )}
        {tab === "assumptions" && (
          <ul className="plain">
            <li>Places, alerts, gauge readings and landslide reports are real records. Their status on the map is modelled, not observed.</li>
            <li>Status uses the flood observed on 30 Sep 2024, two days after the peak, so it may understate flooding at the peak.</li>
            <li>Facility records were last updated between 2021 and 2026. Treat them as registered facilities, not a live census.</li>
            <li>BIPAD states no licence for its data. Confirm before redistributing.</li>
            {note && <li>{note}</li>}
            <li>Recommended actions are examples. Assigning or issuing one only changes this screen.</li>
            <li>No real message is sent and no team is dispatched.</li>
            <li>The research hindcast and Helene replay still live in the app as separate modes.</li>
          </ul>
        )}
        {tab === "activity" && (
          <>
            <ol className="plain">{[...agentLines, ...ACTIVITY].map((a) => <li key={a}>{a}</li>)}</ol>
            <h3>Simulated actions this session</h3>
            {Object.keys(done).length ? <ul className="plain">{Object.entries(done).map(([k, v]) => <li key={k}><code>{k}</code>: {v === "issued" ? "alert issued (simulated)" : "assigned (simulated)"}</li>)}</ul> : <p className="muted">None yet. Select a closure and assign a response.</p>}
          </>
        )}
      </div>
    </div>
  );
}
