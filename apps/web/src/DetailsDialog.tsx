import { useState } from "react";
import { DATA_NOTE } from "./mock/demo.ts";
import { CELL_META, CELL_RISK_M, DARK_AREAS, IODA_REGION, NIGHT, nepalTime } from "./realdata.ts";
import type { Done } from "./ContextDrawer.tsx";

const SOURCES: [string, string, string][] = [
  ["Road geometry", "Real", "OpenStreetMap via Geofabrik, 2 Jan 2024 (ODbL)"],
  ["Satellite base", "Real", "Sentinel-2 cloudless 2020, EOX (CC BY-NC-SA 4.0), shown dimmed"],
  ["Terrain", "Mock", "Low-ground patches drawn for the demo"],
  ["Road closures and cut-off pockets", "Mock", "Illustrative selection, not an assessment"],
  ["Cell sites", "Mixed", `Positions are real: OpenCelliD (CC BY-SA 4.0), ${CELL_META.counts.sites} sites merged from ${CELL_META.counts.cells} cells, crowd-sourced estimates. Status is modelled: inside the observed flood extent is down; within ${CELL_RISK_M} m of it, or where night lights went dark, is at risk. Real site outages are not public`],
  ["Internet connectivity", "Real", `IODA, Georgia Tech. ${IODA_REGION.label}: networks visible on the internet fell ${IODA_REGION.series.bgp!.dropPct}% at ${nepalTime(IODA_REGION.series.bgp!.floodMinAt)} (Nepal time), against the 20 to 26 Sep median. Regional only`],
  ["Weather agent: rainfall forecast", "Mock", "A forecast you set with the slider. Range and intensity are derived by a simple rule"],
  ["Terrain agent: elevation", "Real", "Public elevation tiles (AWS Terrain Tiles, Mapzen). Patches are ranked by how low they sit: ground height at the flood edge minus the low ground inside. The elevation data is too coarse for absolute depths"],
  ["Flood depth", "Illustrative", "Depth scales linearly with rain. The deepest patch is set to 2.4 m at a 10 in reference (an assumption), and patches under 0.2 m show dry. Not a hydraulic simulation"],
  ["Weather layer (rain cells)", "Mock", "Invented rain cells"],
  ["Dams", "Mock", "Invented gauges and levels"],
  ["Social media and radio", "Mock", "Invented posts and call-ins"],
  ["Critical buildings", "Mixed", "Hospital names and positions from OSM; access status invented"],
  ["Power outages", "Real", `NASA Black Marble nightly lights (VNP46A2). ${DARK_AREAS.length} areas where lights fell below half of normal on clear nights, 29 Sep to 2 Oct, against 19 Aug to 25 Sep. 28 Sep was clouded over. False-dark rate on ordinary nights ${(NIGHT.counts.controlFalseDarkRate * 100).toFixed(1)}%. Likely, not confirmed, outages`],
  ["Outputs: alerts, QRT, food, shelter", "Mock", "Invented teams, depots and shelters"],
];
const ACTIVITY = [
  "Road network agent: 6,065 main-road segments loaded (demo subset).",
  "Terrain agent: low-ground patches flagged near river crossings (mock).",
  "Weather and dam agents: heavy rain upstream, gauges high (mock).",
  "Cascade agent: closures and cut-off pockets computed (mock).",
  "Response agent: QRT, food, shelter and grid options drafted per selection (mock).",
];

export function DetailsDialog({ open, onClose, done, agentLines }: { open: boolean; onClose: () => void; done: Done; agentLines: string[] }) {
  const [tab, setTab] = useState<"sources" | "assumptions" | "activity">("sources");
  if (!open) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Details" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="d-head"><h2>Details</h2><button className="icon" onClick={onClose} aria-label="Close">×</button></header>
        <div className="tabs" role="tablist">
          {(["sources", "assumptions", "activity"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>)}
        </div>
        {tab === "sources" && (
          <table><thead><tr><th>Layer</th><th>Status</th><th>Source</th></tr></thead>
            <tbody>{SOURCES.map(([a, b, c]) => <tr key={a}><td>{a}</td><td><span className={`pill ${b.toLowerCase()}`}>{b}</span></td><td>{c}</td></tr>)}</tbody></table>
        )}
        {tab === "assumptions" && (
          <ul className="plain">
            <li>Real layers: road geometry, satellite base, elevation, observed flood extent, OSM buildings, cell-site positions (OpenCelliD), regional internet connectivity (IODA) and power outages from night lights (NASA Black Marble). Everything else is mock or illustrative, and the Sources tab says which.</li>
            <li>{DATA_NOTE}</li>
            <li>Recommended actions are examples. Assigning or issuing one only changes this screen.</li>
            <li>No real message is sent and no team is dispatched.</li>
            <li>The research hindcast (scoring against incident reports) still lives in the repo and docs. It is not part of this demo path.</li>
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
