import { useState } from "react";
import { OPS, SCHOOLS_CHECKED, TIMELINE } from "./real/ops.ts";
import { CELL_META, CELL_RISK_M, DARK_AREAS, IODA_REGION, NIGHT, nepalTime } from "./realdata.ts";
import type { Done } from "./ContextDrawer.tsx";
import type { AgentScore, Scorecard } from "./api.ts";

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
  ["Cell sites", "Mixed", `Positions are real: OpenCelliD (CC BY-SA 4.0), ${CELL_META.counts.sites} sites merged from ${CELL_META.counts.cells} cells, crowd-sourced estimates. Status is modelled: inside the observed flood extent is down; within ${CELL_RISK_M} m of it, or where night lights went dark, is at risk. Real site outages are not public`],
  ["Internet connectivity", "Real", `IODA, Georgia Tech. ${IODA_REGION.label}: networks visible on the internet fell ${IODA_REGION.series.bgp!.dropPct}% at ${nepalTime(IODA_REGION.series.bgp!.floodMinAt)} (Nepal time), against the 20 to 26 Sep median. Regional only`],
  ["Power outages", "Real", `NASA Black Marble nightly lights (VNP46A2). ${DARK_AREAS.length} areas where lights fell below half of normal on clear nights, 29 Sep to 2 Oct, against 19 Aug to 25 Sep. 28 Sep was clouded over. False-dark rate on ordinary nights ${(NIGHT.counts.controlFalseDarkRate * 100).toFixed(1)}%. Likely, not confirmed, outages`],
  ["Facility status", "Modelled", "Closure rule on the real road network under the observed flood. Access is the road trip from central Kathmandu"],
  ["Road closures and cut-off pockets", "Modelled", `From the same engine (${OPS.closedSegments} segments close). The map shows a selection`],
  ["Terrain agent: elevation", "Real", "Public elevation tiles (AWS Terrain Tiles). Used to rank flood patches; absolute depth is an assumption"],
  ["Flood depth and runoff", "Illustrative", "Depth scales with the rain you set. Not a hydraulic simulation"],
  ["Weather agent and rain grid", "Real", `Open-Meteo historical weather API, ECMWF IFS 9 km (CC BY 4.0): ${OPS.weather.total2728Mm} mm valley average on 27–28 Sep 2024. The slider is a what-if on top`],
  ["Atmosphere", "Real", "Open-Meteo cloud cover and MSL pressure (live / cached)"],
  ["Building footprints", "Real", "OSM shelter-relevant footprints for evacuate / shelter-in-place reading"],
  ["Social media", "Real", "Reddit (r/Nepal, r/Kathmandu) via Arctic Shift, 25 Sep to 3 Oct 2024, flood-related only. Places matched by name (GeoNames); tags are a keyword baseline on HumAID categories; non-English posts machine-translated, original kept"],
  ["Radio", "Simulated", "Invented call-ins"],
  ["Food depots", "Simulated", "No public stock feed found"],
];
const ACTIVITY = [
  `Facilities agent: ${OPS.hospitals.length} hospitals, ${SCHOOLS_CHECKED} schools, ${OPS.openSpaces.length} open spaces and ${OPS.responders.length} fire and police bases loaded (real, BIPAD).`,
  `Cascade agent: ${OPS.closedSegments} road segments close under the observed flood; facility access modelled (real roads).`,
  `Hydrology agent: ${OPS.gauges.filter((g) => g.peak >= g.dangerLevel).length} of ${OPS.gauges.length} river gauges passed danger on 27–28 Sep (real, DHM).`,
  `Alerts agent: ${OPS.alerts.length} official alerts loaded (real, BIPAD).`,
  `Weather agent: heaviest 24 h ${OPS.weather.max24hMm} mm valley average; peak ${OPS.weather.peakMmH} mm/h (real, Open-Meteo ECMWF IFS).`,
  `Comms agent: ${CELL_META.counts.sites} OpenCelliD sites (status modelled) and ${DARK_AREAS.length} night-lights dark areas (NASA Black Marble).`,
  "Response agent: options drafted per selection. Food depots, posts and radio are simulated.",
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

/** `legacyActivity` adds the old ops console's fixed agent lines. The forecast console turns it off so the Activity tab
 * lists only the agents it actually runs. */
export function DetailsDialog({ open, onClose, done, agentLines, note, scorecard, legacyActivity = true }: { open: boolean; onClose: () => void; done: Done; agentLines: string[]; note?: string; scorecard: Scorecard | null; legacyActivity?: boolean }) {
  type Tab = "sources" | "timeline" | "assumptions" | "activity" | "evaluation";
  const [tab, setTab] = useState<Tab>(scorecard ? "evaluation" : "sources");
  if (!open) return null;
  const tabs: Tab[] = scorecard
    ? ["evaluation", "sources", "timeline", "assumptions", "activity"]
    : ["sources", "timeline", "assumptions", "activity"];
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Details" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="d-head"><h2>Details</h2><button className="icon" onClick={onClose} aria-label="Close">×</button></header>
        <div className="tabs" role="tablist">
          {tabs.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>)}
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
            <li>Cell-site positions are real (OpenCelliD estimates). Site up/down status is modelled from the observed flood and night lights — not a live operator feed.</li>
            <li>Night-lights dark areas are observed NASA Black Marble cells; treat them as likely power loss, not confirmed utility outages.</li>
            <li>Status uses the flood observed on 30 Sep 2024, two days after the peak, so it may understate flooding at the peak.</li>
            <li>Facility records were last updated between 2021 and 2026. Treat them as registered facilities, not a live census.</li>
            <li>BIPAD states no licence for its data. Confirm before redistributing.</li>
            {note && <li>{note}</li>}
            <li>Recommended actions are examples. Assigning or issuing one only changes this screen.</li>
            <li>No real message is sent and no team is dispatched.</li>
          </ul>
        )}
        {tab === "activity" && (
          <>
            <ol className="plain">{[...agentLines, ...(legacyActivity ? ACTIVITY : [])].map((a) => <li key={a}>{a}</li>)}</ol>
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
