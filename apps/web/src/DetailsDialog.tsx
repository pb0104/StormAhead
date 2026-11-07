import { useState } from "react";
import type { Done } from "./ContextDrawer.tsx";

const SOURCES: [string, string, string][] = [
  ["Road geometry", "Real", "OpenStreetMap via Geofabrik, 2 Jan 2024 (ODbL)"],
  ["Satellite base", "Real", "Sentinel-2 cloudless 2020, EOX (CC BY-NC-SA 4.0), shown dimmed"],
  ["Terrain", "Mock", "Low-ground patches drawn for the demo"],
  ["Road closures and cut-off pockets", "Mock", "Illustrative selection, not an assessment"],
  ["Cell towers", "Real (OSM)", "OpenStreetMap masts / communication towers via Overpass; outage status still demo"],
  ["Weather agent: rainfall forecast", "Mixed", "Seeded from Open-Meteo when available; slider remains the interactive control"],
  ["Terrain agent: elevation", "Real", "Public elevation tiles (AWS Terrain Tiles, Mapzen). Patches are ranked by how low they sit: ground height at the flood edge minus the low ground inside. The elevation data is too coarse for absolute depths"],
  ["Flood depth", "Illustrative", "Depth scales linearly with rain. The deepest patch is set to 2.4 m at a 10 in reference (an assumption), and patches under 0.2 m show dry. Not a hydraulic simulation"],
  ["Weather layer (rain cells)", "Mock", "Invented rain cells"],
  ["Dams", "Real (OSM)", "OpenStreetMap waterway/man_made=dam via Overpass; levels still illustrative"],
  ["Critical buildings", "Real (OSM)", "Hospitals, clinics, schools, airports, helipads, shelters from OpenStreetMap; cascade access/risk status still demo"],
  ["Outputs: QRT, food, shelter staging, outages", "Mock", "Invented teams, depots and feeders (shelter sites may be OSM)"],
];
const ACTIVITY = [
  "Assets agent: hospitals, schools, dams, airports, helipads, towers, shelters loaded from OpenStreetMap (Overpass).",
  "Road network agent: demo road / closure fixture loaded.",
  "Terrain agent: elevation tiles ranked for flood patches.",
  "Weather agent: rainfall seed (Open-Meteo or fallback) + slider.",
  "Cascade agent: closures and cut-off pockets from demo fixture.",
];

export function DetailsDialog({ open, onClose, done, agentLines, note }: { open: boolean; onClose: () => void; done: Done; agentLines: string[]; note: string }) {
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
            <li>Everything on the map except the road geometry and the satellite base is mock or illustrative.</li>
            <li>{note}</li>
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
