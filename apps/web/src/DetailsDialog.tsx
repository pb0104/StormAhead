import { useState } from "react";
import { DATA_NOTE } from "./mock/demo.ts";
import type { Done } from "./ContextDrawer.tsx";
import type { Scorecard } from "./api.ts";

const SOURCES: [string, string, string][] = [
  ["Road geometry", "Real", "OpenStreetMap via Geofabrik, 2 Jan 2024 (ODbL)"],
  ["Satellite base", "Real", "Sentinel-2 cloudless 2020, EOX (CC BY-NC-SA 4.0), shown dimmed"],
  ["Terrain", "Mock", "Low-ground patches drawn for the demo"],
  ["Road closures and cut-off pockets", "Mock", "Illustrative selection, not an assessment"],
  ["Cell towers", "Mock", "Invented sites and outage status"],
  ["Weather agent: rainfall forecast", "Mock", "A forecast you set with the slider. Range and intensity are derived by a simple rule"],
  ["Terrain agent: elevation", "Real", "Public elevation tiles (AWS Terrain Tiles, Mapzen). Patches are ranked by how low they sit: ground height at the flood edge minus the low ground inside. The elevation data is too coarse for absolute depths"],
  ["Flood depth", "Illustrative", "Depth scales linearly with rain. The deepest patch is set to 2.4 m at a 10 in reference (an assumption), and patches under 0.2 m show dry. Not a hydraulic simulation"],
  ["Weather layer (rain cells)", "Mock", "Invented rain cells"],
  ["Dams", "Mock", "Invented gauges and levels"],
  ["Social media and radio", "Mock", "Invented posts and call-ins"],
  ["Critical buildings", "Mixed", "Hospital names and positions from OSM; access status invented"],
  ["Outputs: alerts, QRT, food, shelter, outages", "Mock", "Invented teams, depots, shelters and feeders"],
];
const ACTIVITY = [
  "Road network agent: 6,065 main-road segments loaded (demo subset).",
  "Terrain agent: low-ground patches flagged near river crossings (mock).",
  "Weather and dam agents: heavy rain upstream, gauges high (mock).",
  "Cascade agent: closures and cut-off pockets computed (mock).",
  "Response agent: QRT, food, shelter and grid options drafted per selection (mock).",
];

const num = (x: number | null, d = 2) => (x === null ? "—" : x.toFixed(d));

export function DetailsDialog({ open, onClose, done, agentLines, scorecard }: { open: boolean; onClose: () => void; done: Done; agentLines: string[]; scorecard: Scorecard | null }) {
  type Tab = "sources" | "assumptions" | "activity" | "evaluation";
  const [tab, setTab] = useState<Tab>("sources");
  if (!open) return null;
  const tabs: Tab[] = scorecard ? ["sources", "assumptions", "activity", "evaluation"] : ["sources", "assumptions", "activity"];
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Details" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="d-head"><h2>Details</h2><button className="icon" onClick={onClose} aria-label="Close">×</button></header>
        <div className="tabs" role="tablist">
          {tabs.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>)}
        </div>
        {tab === "sources" && (
          <table><thead><tr><th>Layer</th><th>Status</th><th>Source</th></tr></thead>
            <tbody>{SOURCES.map(([a, b, c]) => <tr key={a}><td>{a}</td><td><span className={`pill ${b.toLowerCase()}`}>{b}</span></td><td>{c}</td></tr>)}</tbody></table>
        )}
        {tab === "assumptions" && (
          <ul className="plain">
            <li>Everything on the map except the road geometry and the satellite base is mock or illustrative.</li>
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
        {tab === "evaluation" && scorecard && (() => {
          const w = scorecard.wardScore;
          return (
            <>
              {/* The console on screen is a demo with invented closures. This scorecard measures the REAL engine.
                  Saying so first is not optional: without it the table reads as validation of the demo. */}
              <p className="warn">
                <strong>This does not score the map on screen.</strong> The console’s closures and pockets are invented demo data.
                The table below scores the <em>real</em> hindcast engine — run on the OpenStreetMap road network
                ({scorecard.network.snapshot}) and the observed flood extent — against incident reports it never saw.
              </p>
              <p className="muted">
                {w.evaluatedIncidents} verified flood reports ({scorecard.incidents.window?.join(" to ")}) fall in{" "}
                <strong>{w.truthWards} of {w.wards} wards</strong>. Each agent is compared with {w.permutations.toLocaleString()} random
                ward sets of its own size, so flagging more wards earns no credit.
              </p>
              <table>
                <thead><tr><th>Agent</th><th>Wards flagged</th><th>Hit</th><th>False alarm</th><th>Precision</th><th>Recall</th><th>F1</th><th>Random F1</th><th>p</th></tr></thead>
                <tbody>
                  {w.agents.map((a) => {
                    const c = a.confusion, given = a.agent.includes("GIVEN");
                    return (
                      <tr key={a.agent} className={given ? "given" : undefined}>
                        <td title={a.what}>{a.agent}</td>
                        <td>{a.flaggedWards}</td><td>{c.tp}</td><td>{c.fp}</td>
                        <td>{num(c.precision)}</td><td>{num(c.recall)}</td><td>{num(c.f1)}</td>
                        <td>{a.randomBaseline.meanF1.toFixed(2)}</td>
                        <td><strong>{a.randomBaseline.p.toFixed(3)}</strong></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <ul className="plain">
                <li>The <em>hazard</em> row is the observed flood extent, which is an <strong>input</strong>, not a prediction. It is the bar: an agent that does not beat it adds nothing to the flood map.</li>
                <li><strong>No agent shows convincing skill.</strong> The one result under p&nbsp;&lt;&nbsp;0.05 does not survive rebuilding the road network one day before the event, so treat it as noise.</li>
                <li>{w.note}</li>
                <li>Wards: {scorecard.wards?.source} ({scorecard.wards?.snapshot}). Reports: {scorecard.incidents.source}.</li>
              </ul>
            </>
          );
        })()}
      </div>
    </div>
  );
}
