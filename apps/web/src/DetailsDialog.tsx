import { useState } from "react";
import { OPS, SCHOOLS_CHECKED, TIMELINE } from "./real/ops.ts";
import { CELL_META, CELL_RISK_M, DARK_AREAS, IODA_REGION, NIGHT, nepalTime } from "./realdata.ts";
import type { Done } from "./ContextDrawer.tsx";
import type { EvalReport, Scorecard } from "./api.ts";

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
  ["Census population (area card)", "Real", "National Population and Housing Census 2021 via BIPAD, per municipality: population, households, under-5s, 65+. No ward-level census is published there, so a ward figure is an estimate (municipality ÷ its wards)"],
  ["Relief budget and vehicles (resource allocation agent)", "Mixed", "Real: Nepal Minimum Expenditure Basket (NPR 15,000 per household a month), 3-day emergency phase (IFRC 2024: Kathmandu water receded after three days), household size, flood extent, census, responder bases. Anchored: shelter kit ≈ NPR 11,500 and 34% needing relief (IFRC 2024 response), 30-day support period, NPR 6.75 crore fund (NDRRMA's first 2026 Bhotekoshi release), helicopter US$2,000/h. Mocked: vehicle day rates and QRT crew cost. Full list with links in the Allocation section"],
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

/** `legacyActivity` adds the old ops console's fixed agent lines. The forecast console turns it off so the Activity tab
 * lists only the agents it actually runs. */
export function DetailsDialog({ open, onClose, done, agentLines, scorecard, evaluation, legacyActivity = true }: {
  open: boolean; onClose: () => void; done: Done; agentLines: string[];
  scorecard: Scorecard | null; evaluation?: EvalReport | null; legacyActivity?: boolean;
}) {
  type Tab = "sources" | "timeline" | "activity" | "evaluation";
  const hasEval = !!(evaluation || scorecard);
  const [tab, setTab] = useState<Tab>(hasEval ? "evaluation" : "sources");
  if (!open) return null;
  const tabs: Tab[] = hasEval
    ? ["evaluation", "sources", "timeline", "activity"]
    : ["sources", "timeline", "activity"];
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Details" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="d-head"><h2>Details</h2><button className="icon" onClick={onClose} aria-label="Close">×</button></header>
        <div className="tabs" role="tablist">
          {tabs.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>)}
        </div>
        {tab === "sources" && (
          <table><thead><tr><th>Layer</th><th>Source</th></tr></thead>
            <tbody>{SOURCES.map(([a, , c]) => <tr key={a}><td>{a}</td><td>{c}</td></tr>)}</tbody></table>
        )}
        {tab === "timeline" && (
          <>
            <p className="muted">27–28 Sep 2024, local time. Rain, river gauges and official alerts on one clock, all real.</p>
            <ol className="timeline">{TIMELINE.map((t, i) => <li key={i}><time>{t.at.slice(8, 10)} Sep {t.at.slice(11, 16)}</time><span>{t.what}<small>{t.src}</small></span></li>)}</ol>
          </>
        )}
        {tab === "activity" && (
          <>
            <ol className="plain">{[...agentLines, ...(legacyActivity ? ACTIVITY : [])].map((a) => <li key={a}>{a}</li>)}</ol>
            <h3>Simulated actions this session</h3>
            {Object.keys(done).length ? <ul className="plain">{Object.entries(done).map(([k, v]) => <li key={k}><code>{k}</code>: {v === "issued" ? "alert issued (simulated)" : "assigned (simulated)"}</li>)}</ul> : <p className="muted">None yet. Select a closure and assign a response.</p>}
          </>
        )}
        {tab === "evaluation" && evaluation && <EvaluationPanel evaluation={evaluation} />}
        {tab === "evaluation" && !evaluation && scorecard && (
          <p className="muted">Loading the evaluation pack… ward scorecard is available ({scorecard.wardScore.truthWards} impact wards).</p>
        )}
      </div>
    </div>
  );
}

function EvaluationPanel({ evaluation: e }: { evaluation: EvalReport }) {
  const overall = (e.pillars.reduce((s, p) => s + p.score, 0) / e.pillars.length).toFixed(1);
  return (
    <>
      <div className="verdict ok">
        <h3>How we validate <span className="yes">{overall} / 5</span></h3>
        <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--mute)", lineHeight: 1.55 }}>{e.headline}</p>
        <ul>
          <li><strong>Ground truth:</strong> UNOSAT flood map + Maxar before/after + withheld BIPAD impact reports.</li>
          <li><strong>Method:</strong> {e.method}</li>
          <li><strong>Human gate:</strong> every draft alert or resource move still needs approve / edit / reject.</li>
        </ul>
      </div>

      <h3>LLM council — five pillars</h3>
      <p className="muted">Three judges score each pillar 1–5. Shown score is the median.</p>
      <div className="pillar-grid">
        {e.pillars.map((p) => (
          <article key={p.id} className="pillar-card">
            <header>
              <strong>{p.name}</strong>
              <span className="pillar-score">{p.score.toFixed(1)}</span>
            </header>
            <p className="pillar-q">{p.question}</p>
            <p className="pillar-why">{p.rationale}</p>
            <ul className="pillar-judges">
              {p.judges.map((j) => (
                <li key={j.judge}><span>{j.judge.replace("Council · ", "")}</span><b>{j.score.toFixed(1)}</b></li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <h3>Ground-truth metrics</h3>
      <p className="muted">Computed from the real Kathmandu hindcast against withheld reports — not invented demo numbers.</p>
      <table>
        <thead><tr><th>Metric</th><th>Value</th><th>What it means</th></tr></thead>
        <tbody>
          {e.metrics.map((m) => (
            <tr key={m.id}><td>{m.label}</td><td><strong>{m.value}</strong></td><td>{m.detail}</td></tr>
          ))}
        </tbody>
      </table>

    </>
  );
}
