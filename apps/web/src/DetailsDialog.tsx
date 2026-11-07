import { useState } from "react";
import type { Done } from "./ContextDrawer.tsx";
import type { AgentScore, Scorecard } from "./api.ts";

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

const num = (x: number | null, d = 2) => (x === null ? "—" : x.toFixed(d));

/**
 * A plain-language reading of one agent's row.
 *
 * The table alone is not interpretable without knowing what counts as good, and the honest answer here is
 * "none of this is good". Generated from the numbers rather than written out, so it cannot drift from them.
 */
function reading(a: AgentScore, truthWards: number, wards: number): string {
  const c = a.confusion, p = a.randomBaseline.p;
  const share = Math.round((a.flaggedWards / wards) * 100);
  const where = `Flags ${a.flaggedWards} of ${wards} wards (${share}%) and catches ${c.tp} of the ${truthWards} that reported damage; ${c.fp} of its flags had nothing reported.`;
  if (a.agent.includes("GIVEN")) return `${where} This is the flood extent the engine is GIVEN, so it is not a prediction — it is the bar. An agent that does not beat this row has added nothing to simply knowing where the water was.`;
  if (p >= 0.2) return `${where} Random ward sets of the same size do just as well (p = ${p.toFixed(3)}), so there is no evidence of skill here.`;
  if (p >= 0.05) return `${where} Random sets of the same size do nearly as well (p = ${p.toFixed(3)}), so this is suggestive at best, not a result.`;
  return `${where} This beats same-size random sets (p = ${p.toFixed(3)}), the only row that does — but on ${c.tp} hits, and it does not hold when the road network is rebuilt one day before the event (p becomes 0.052). Treat it as noise.`;
}

export function DetailsDialog({ open, onClose, done, agentLines, note, scorecard }: { open: boolean; onClose: () => void; done: Done; agentLines: string[]; note: string; scorecard: Scorecard | null }) {
  type Tab = "sources" | "assumptions" | "activity" | "evaluation";
  const [tab, setTab] = useState<Tab>(scorecard ? "evaluation" : "sources");
  if (!open) return null;
  const tabs: Tab[] = scorecard ? ["evaluation", "sources", "assumptions", "activity"] : ["sources", "assumptions", "activity"];
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
        {tab === "evaluation" && scorecard && (() => {
          const w = scorecard.wardScore;
          const combined = w.agents.find((a) => a.agent === "All agents combined");
          return (
            <>
              {/* The console on screen is a demo with invented closures. This scorecard measures the REAL engine.
                  Saying so first is not optional: without it the table reads as validation of the demo. */}
              <p className="warn">
                <strong>This does not score the map on screen.</strong> The console’s closures and pockets are invented demo data.
                The table below scores the <em>real</em> hindcast engine — run on the OpenStreetMap road network
                ({scorecard.network.snapshot}) and the observed flood extent — against incident reports it never saw.
              </p>
              <div className="verdict">
                <h3>Does the engine predict flood impact? <span className="no">On this event, no.</span></h3>
                <ul>
                  <li><strong>What it got right:</strong> {combined ? `${combined.confusion.tp} of the ${w.truthWards} wards that reported damage were flagged by some agent.` : "—"}</li>
                  <li><strong>What it got wrong:</strong> {combined ? `${combined.confusion.fp} of its ${combined.flaggedWards} flagged wards reported nothing — that is ${Math.round((combined.flaggedWards / w.wards) * 100)}% of the valley flagged.` : "—"} A warning that covers most of the map is not a warning.</li>
                  <li><strong>Why that is not skill:</strong> picking the same number of wards at random scores about as well. No agent clears both its random and its proximity baseline.</li>
                  <li><strong>What it does NOT mean:</strong> not that the idea is wrong. The test rests on {w.evaluatedIncidents} reported incidents in {w.truthWards} wards — far too few to detect a modest real effect. A null result here is weak evidence, not proof of no effect.</li>
                  <li><strong>What would change the answer:</strong> a hospital set restricted to facilities that can actually receive patients (OSM lists 185–252 "hospitals", mostly small clinics, so access almost never breaks); more ground truth than reported incidents; a hazard input that does not under-detect urban flooding.</li>
                </ul>
              </div>
              <p className="muted">
                {w.evaluatedIncidents} verified flood reports ({scorecard.incidents.window?.join(" to ")}) fall in{" "}
                <strong>{w.truthWards} of {w.wards} wards</strong>. Each agent is compared with {w.permutations.toLocaleString()} random
                ward sets of its own size, so flagging more wards earns no credit. Precision is the share of flags that were
                right; recall is the share of damaged wards caught; <strong>p</strong> is the chance a random set of the same
                size would score at least as well — <strong>low is good, and above about 0.05 means indistinguishable from guessing</strong>.
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
              <h3>What each row means</h3>
              <dl className="readings">
                {w.agents.map((a) => (
                  <div key={a.agent}>
                    <dt className={a.agent.includes("GIVEN") ? "given" : undefined}>{a.agent}</dt>
                    <dd>{reading(a, w.truthWards, w.wards)}</dd>
                  </div>
                ))}
              </dl>
              <h3>Caveats that bound all of the above</h3>
              <ul className="plain">
                <li>{w.note}</li>
                <li>Ground truth is <em>reported</em> damage. A ward with no report is not proven undamaged, so some of those false alarms may be real damage nobody filed — and recall is a lower bound.</li>
                <li>Wards: {scorecard.wards?.source} ({scorecard.wards?.snapshot}). Reports: {scorecard.incidents.source}. Network: {scorecard.network.snapshot}.</li>
              </ul>
            </>
          );
        })()}
      </div>
    </div>
  );
}
