import { useEffect, useMemo, useRef, useState } from "react";
import { maplibregl } from "./mapsetup.ts";
import { hindcast, pipeline, type AlertLevel, type HindcastGeo, type ModelSet, type PipelineMeta, type PipelineRun, type WardOut } from "./api.ts";
import { GaugeCharts } from "./GaugeCharts.tsx";

type Hazard = "flood" | "landslide";
type Audience = "authority" | "public";
const START_DATE = "2024-09-27";
const FLOOD_FAMILY = ["Flood", "Inundation", "Heavy Rainfall"];
const STEPS = [0.0005, 0.002, 0.005, 0.015];
const RAMPS: Record<Hazard, string[]> = { flood: ["#2d5a8c", "#2f76c4", "#3f9be3", "#6cc0f4", "#b5e3ff"], landslide: ["#774718", "#a0601e", "#cf7f28", "#f0a14a", "#ffd59e"] };
const BANDS = ["under 0.05%", "0.05–0.2%", "0.2–0.5%", "0.5–1.5%", "1.5% or more"];
const ALERT_LINE = { "public-draft": "#fb7185", authority: "#fbbf24" };
const ALERT_TEXT: Record<AlertLevel, string> = { "public-draft": "Public draft", authority: "Authority", none: "No alert" };

const risk = (w: WardOut, h: Hazard) => (h === "flood" ? w.floodRisk : w.landslideRisk);
const pct = (v: number) => (v >= 0.1 ? `${(v * 100).toFixed(0)}%` : v >= 0.001 ? `${(v * 100).toFixed(1)}%` : "<0.1%");
const longDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const visibleAlert = (a: AlertLevel, audience: Audience): AlertLevel => (audience === "public" && a === "authority" ? "none" : a);

function Toggle({ on, set, children }: { on: boolean; set: (v: boolean) => void; children: React.ReactNode }) {
  return <label className="check"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /><span>{children}</span></label>;
}
function Seg<T extends string>({ value, set, options, label }: { value: T; set: (v: T) => void; options: [T, string][]; label: string }) {
  return <div className="seg" role="group" aria-label={label}>{options.map(([v, t]) => <button key={v} aria-pressed={value === v} className={value === v ? "active" : ""} onClick={() => set(v)}>{t}</button>)}</div>;
}
const Pill = ({ a }: { a: AlertLevel }) => <span className={`pill ${a}`}>{ALERT_TEXT[a]}</span>;

export function DetectView() {
  const [meta, setMeta] = useState<PipelineMeta | null>(null);
  const [geo, setGeo] = useState<HindcastGeo | null>(null);
  const [areas, setAreas] = useState<any>(null);
  const [date, setDate] = useState(START_DATE);
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hazard, setHazard] = useState<Hazard>("flood");
  const [audience, setAudience] = useState<Audience>("authority");
  const [show, setShow] = useState({ incidents: true, screen: false, hospitals: false, unosat: false });
  const [tab, setTab] = useState<"today" | "wards" | "activity" | "evidence">("today");
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const runRef = useRef<PipelineRun | null>(null);
  runRef.current = run;

  useEffect(() => { (async () => {
    try {
      const m = await pipeline.meta(); setMeta(m);
      if (m.available) { const [g, a] = await Promise.all([hindcast.geo(), pipeline.geo()]); setGeo(g); setAreas(a); }
    } catch (e) { setErr((e as Error).message); }
  })(); }, []);

  useEffect(() => {
    if (!meta?.available) return;
    let live = true;
    setBusy(true); setErr(null);
    pipeline.run(date).then((r) => { if (live) setRun(r); }).catch((e) => { if (live) setErr((e as Error).message); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [date, meta]);

  useEffect(() => {
    if (!geo || !areas || !el.current) return;
    const m = new maplibregl.Map({
      container: el.current, attributionControl: false,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0a1120" } }] },
      bounds: [[85.284, 27.587], [85.493, 27.788]], fitBoundsOptions: { padding: { left: 340, right: 520, top: 20, bottom: 20 } },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      m.addSource("wards", { type: "geojson", data: areas, promoteId: "id" });
      m.addSource("roads", { type: "geojson", data: geo.roads });
      m.addSource("unosat", { type: "geojson", data: geo.flood });
      m.addSource("hosp", { type: "geojson", data: fc(geo.hospitals.map((h) => pt(h.lon, h.lat, { n: h.n }))) });
      m.addSource("inc", { type: "geojson", data: fc([]) });
      m.addLayer({ id: "ward-fill", type: "fill", source: "wards", paint: { "fill-color": "#16233a", "fill-opacity": 0.82 } });
      m.addLayer({ id: "ward-edge", type: "line", source: "wards", paint: { "line-color": "#0a1120", "line-width": 0.8 } });
      m.addLayer({ id: "roads", type: "line", source: "roads", filter: ["!", ["in", ["get", "c"], ["literal", ["residential", "unclassified", "living_street"]]]], paint: { "line-color": "#e8eef9", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.3, 15, 2], "line-opacity": 0.28 } });
      m.addLayer({ id: "unosat", type: "fill", source: "unosat", layout: { visibility: "none" }, paint: { "fill-color": "#f5f5f5", "fill-opacity": 0.55 } });
      m.addLayer({ id: "screen-cut", type: "line", source: "roads", filter: ["in", ["get", "i"], ["literal", []]], layout: { visibility: "none" }, paint: { "line-color": "#c084fc", "line-width": 0.7, "line-opacity": 0.7 } });
      m.addLayer({ id: "screen-exp", type: "line", source: "roads", filter: ["in", ["get", "i"], ["literal", []]], layout: { visibility: "none" }, paint: { "line-color": "#fb923c", "line-width": 1.1 } });
      m.addLayer({ id: "ward-alert", type: "line", source: "wards", filter: ["in", ["get", "id"], ["literal", []]], paint: { "line-color": ["coalesce", ["feature-state", "line"], "#fbbf24"], "line-width": ["coalesce", ["feature-state", "width"], 1.4] } });
      m.addLayer({ id: "ward-sel", type: "line", source: "wards", filter: ["==", ["get", "id"], -1], paint: { "line-color": "#ffffff", "line-width": 2.5 } });
      m.addLayer({ id: "hosp", type: "circle", source: "hosp", layout: { visibility: "none" }, paint: { "circle-radius": 3.5, "circle-color": "#34d399", "circle-stroke-color": "#0a1120", "circle-stroke-width": 1 } });
      m.addLayer({ id: "inc", type: "circle", source: "inc", paint: { "circle-radius": 6, "circle-color": "#0a1120", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
      m.on("click", "inc", (e: any) => { const q = e.features?.[0]?.properties; if (q) new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<b>${esc(q.title)}</b><br>Reported ${esc(q.hazard)}. Checked after prediction.`).addTo(m); });
      m.on("click", "ward-fill", (e: any) => {
        if (m.queryRenderedFeatures(e.point, { layers: ["inc"] }).length) return;
        const id = e.features?.[0]?.properties?.id, w = runRef.current?.wards.find((x) => x.id === id);
        if (w) new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<b>${esc(w.name)}</b><br>Flood ${pct(w.floodRisk)} · Landslide ${pct(w.landslideRisk)}<br>${ALERT_TEXT[w.alert]} · about ${w.population.toLocaleString()} people`).addTo(m);
      });
      for (const id of ["inc", "ward-fill"]) { m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer")); m.on("mouseleave", id, () => (m.getCanvas().style.cursor = "")); }
      setMapReady(true);
    });
    map.current = m;
    return () => { setMapReady(false); m.remove(); };
  }, [geo, areas]);

  useEffect(() => {
    const m = map.current; if (!mapReady || !m) return;
    const ramp = RAMPS[hazard], byId = new Map(run?.wards.map((w) => [w.id, w]) ?? []);
    const color: any[] = ["match", ["get", "id"]];
    for (const w of run?.wards ?? []) { const v = risk(w, hazard); color.push(w.id, ramp[STEPS.filter((s) => v >= s).length]!); }
    m.setPaintProperty("ward-fill", "fill-color", byId.size ? [...color, "#16233a"] : "#16233a");
    const flagged = (run?.wards ?? []).filter((w) => visibleAlert(w.alert, audience) !== "none");
    m.setFilter("ward-alert", ["in", ["get", "id"], ["literal", flagged.map((w) => w.id)]]);
    for (const w of flagged) m.setFeatureState({ source: "wards", id: w.id }, { line: ALERT_LINE[w.alert as "authority" | "public-draft"], width: w.alert === "public-draft" ? 2.2 : 1.2 });
    (m.getSource("inc") as any).setData(fc((run?.incidents ?? []).filter((i) => (hazard === "flood" ? FLOOD_FAMILY.includes(i.hazard) : i.hazard === "Landslide")).map((i) => pt(i.lon, i.lat, { title: i.title, hazard: i.hazard }))));
    m.setFilter("screen-exp", ["in", ["get", "i"], ["literal", run?.roadScreen?.exposedEdges ?? []]]);
    m.setFilter("screen-cut", ["in", ["get", "i"], ["literal", run?.roadScreen?.cutOffEdges ?? []]]);
  }, [run, hazard, audience, mapReady]);

  useEffect(() => {
    const m = map.current; if (!mapReady || !m) return;
    const vis = (id: string, on: boolean) => m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("inc", show.incidents); vis("screen-exp", show.screen); vis("screen-cut", show.screen); vis("hosp", show.hospitals); vis("unosat", show.unosat);
  }, [show, mapReady]);

  const stepDate = (d: number) => { if (!meta) return; const i = meta.dates.indexOf(date); const n = meta.dates[i + d]; if (n) setDate(n); };
  const focus = (w: WardOut) => { const m = map.current; if (!m) return; m.setFilter("ward-sel", ["==", ["get", "id"], w.id]); m.easeTo({ center: [w.lon, w.lat], zoom: Math.max(m.getZoom(), 12.5), padding: { left: 340, right: 520, top: 20, bottom: 20 } }); };

  const ranked = useMemo(() => (run?.wards ?? []).slice().sort((a, b) => risk(b, hazard) - risk(a, hazard)), [run, hazard]);
  const listed = ranked.filter((w) => audience === "authority" || w.alert === "public-draft");
  const flagged = run?.wards.filter((w) => w.alert !== "none").length ?? 0;
  const drafts = run?.wards.filter((w) => w.alert === "public-draft").length ?? 0;
  const wardCount = run?.wards.length ?? 0;
  const weakModel = !!run && run.training.floodIncidents < 20;
  const v = run?.verification;

  if (meta && !meta.available) return <div className="hind-empty"><h2>Pipeline inputs not prepared</h2><p>See <code>docs/pipeline.md</code>, then reload.</p></div>;
  return (
    <div className="hind">
      <aside className="left">
        <h2>Replay a day</h2>
        <div className="datebar">
          <button aria-label="Previous day" disabled={busy} onClick={() => stepDate(-1)}>‹</button>
          <input type="date" aria-label="Date" value={date} min={meta?.dates[0]} max={meta?.dates[meta.dates.length - 1]} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button aria-label="Next day" disabled={busy} onClick={() => stepDate(1)}>›</button>
        </div>
        <label className="field">Jump to a past event
          <select value={meta?.events.some((e) => e.date === date) ? date : ""} onChange={(e) => e.target.value && setDate(e.target.value)}>
            <option value="">Choose an event</option>
            {meta?.events.map((e) => <option key={e.date} value={e.date}>{longDate(e.date)} · {e.incidents} incidents</option>)}
          </select>
        </label>
        <h2>View</h2>
        <h3>Hazard</h3>
        <Seg value={hazard} set={setHazard} label="Hazard" options={[["flood", "Flood"], ["landslide", "Landslide"]]} />
        <h3>Audience</h3>
        <Seg value={audience} set={setAudience} label="Audience" options={[["authority", "Authority"], ["public", "Public"]]} />
        <p className="hint">{audience === "authority" ? "Authorities see earlier, less certain risk." : "The public view keeps only stricter drafts, which need a river above danger and human approval."}</p>
        <h2>Layers</h2>
        <Toggle on={show.incidents} set={(x) => setShow({ ...show, incidents: x })}>Reported incidents (checked after)</Toggle>
        <Toggle on={show.screen} set={(x) => setShow({ ...show, screen: x })}>Road worst-case screen</Toggle>
        <Toggle on={show.hospitals} set={(x) => setShow({ ...show, hospitals: x })}>Hospitals</Toggle>
        <Toggle on={show.unosat} set={(x) => setShow({ ...show, unosat: x })}>UNOSAT flood, 30 Sep 2024 (reference)</Toggle>
        <div className="legend2">
          <div className="ramp-t">Chance of a reported {hazard === "flood" ? "flood" : "landslide"} in the ward that day</div>
          <div className="ramp">{RAMPS[hazard].map((c, i) => <div key={c}><i style={{ background: c }} /><span>{BANDS[i]}</span></div>)}</div>
          <div><i className="l" style={{ background: ALERT_LINE["public-draft"], height: 3 }} /> public draft{audience === "authority" && <> · <i className="l" style={{ background: ALERT_LINE.authority, height: 2 }} /> authority</>}</div>
          <div><i className="d" style={{ background: "#0a1120", border: "2px solid #fff" }} /> reported {hazard === "flood" ? "flood or heavy rain" : "landslide"}</div>
          {show.screen && <div><i className="l" style={{ background: "#fb923c" }} /> exposed · <i className="l" style={{ background: "#c084fc" }} /> could be cut off</div>}
          {show.hospitals && <div><i className="d" style={{ background: "#34d399" }} /> hospital</div>}
          {show.unosat && <div><i className="d" style={{ background: "#f5f5f5", borderRadius: 2 }} /> UNOSAT flood</div>}
          <div className="note">Outlines show flood alerts in both hazard views. Ward shapes are approximate.</div>
        </div>
      </aside>
      <main><div ref={el} className="map" />{busy && <div className="scan" />}{!geo && !err && <div className="loading">Loading the valley…</div>}</main>
      <aside className="right">
        <nav>{(["today", "wards", "activity", "evidence"] as const).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{{ today: "Today", wards: "Wards", activity: "Activity", evidence: "How good is it?" }[t]}</button>)}</nav>
        <div className="panel">
          {err && <div className="warn">{err}</div>}
          {!run && !err && <p className="empty">Running the pipeline…</p>}
          {tab === "today" && run && <>
            <div className="dayhead"><b>{longDate(run.date)}</b>{busy && <span className="meta"> updating…</span>}</div>
            <div className={`verdict ${flagged ? "" : "ok"}`}>
              <b className="t">{run.river?.aboveDanger ? "River above danger" : flagged ? "Elevated risk" : "No alert"}</b>
              {flagged ? `${flagged} of ${wardCount} wards flagged, including ${drafts} with a public draft. Nothing has been sent.` : "No ward passes the alert threshold today."}
            </div>
            {weakModel && <div className="warn">Trained on only {run.training.floodIncidents} earlier flood reports, so treat ward rankings on this date as weak.</div>}
            <div className="kpis">
              <div className="kpi blue"><b>{run.river?.peak == null ? "n/a" : `${run.river.peak.toFixed(2)} m`}</b><span>Khokana highest reading (danger {run.river?.dangerLevel ?? "?"} m)</span></div>
              <div className="kpi orange"><b>{flagged}</b><span>wards flagged</span></div>
              <div className="kpi red"><b>{drafts}</b><span>public drafts awaiting approval</span></div>
            </div>
            {run.series.station && run.series.dangerLevel !== null && <GaugeCharts hours={run.series.hours} date={run.date} warning={run.series.warningLevel!} danger={run.series.dangerLevel} station={run.series.station} />}
            <h3>Checked after prediction</h3>
            {v && v.reported > 0
              ? <p className="meta"><b>{v.inFlaggedWards} of {v.reported}</b> reported flood-family incidents fell in flagged wards. The model flagged {Math.round((flagged / Math.max(1, wardCount)) * 100)}% of wards, so compare the two: {v.inFlaggedWards / v.reported > (flagged / Math.max(1, wardCount)) * 1.25 ? "better than chance on where." : "about chance on where, even when it gets the day right."}</p>
              : <p className="meta">No flood-family incidents were reported on this date.</p>}
            <h3>Roads</h3>
            {run.roadScreen
              ? <div className="warn"><b>Worst case, not a closure prediction.</b> {run.roadScreen.counts.closedEdges!.toLocaleString()} road segments exposed and {run.roadScreen.counts.strandedEdges!.toLocaleString()} that could be cut off. This over-predicts heavily. Turn on the layer to see it.</div>
              : <p className="meta">The river stayed below danger, so no road screen was produced.</p>}
          </>}
          {tab === "wards" && run && <>
            <p className="meta">{audience === "public" ? `${listed.length} public drafts, each needing human approval.` : `All ${listed.length} wards, highest ${hazard} risk first.`} Select a row to find it on the map. Population is a rough estimate.</p>
            <table><thead><tr><th>Ward</th><th>Flood</th><th>Slide</th><th>Alert</th><th>People</th></tr></thead><tbody>
              {listed.map((w) => <tr key={w.id} className="pick" tabIndex={0} onClick={() => focus(w)} onKeyDown={(e) => e.key === "Enter" && focus(w)}><td>{w.name}</td><td>{pct(w.floodRisk)}</td><td>{pct(w.landslideRisk)}</td><td><Pill a={w.alert} /></td><td>{w.population.toLocaleString()}</td></tr>)}
            </tbody></table>
          </>}
          {tab === "activity" && run && <ol className="events">{run.events.map((e) => <li key={e.id}><div><span className="agent">{e.agent}</span> → <code>{e.tool}</code></div><div className="sum">{e.summary}</div></li>)}</ol>}
          {tab === "evidence" && <Evidence meta={meta} />}
        </div>
      </aside>
    </div>
  );
}

const SET_NAMES: Record<string, string> = { exposure: "People and roads", terrain: "Terrain", rain: "Rain", full: "Full model" };
function Evidence({ meta }: { meta: PipelineMeta | null }) {
  const ev = meta?.evaluation;
  if (!ev) return <p className="empty">Run <code>npm run eval</code> to generate this page.</p>;
  const same = ev.wardModel[0]!, next = ev.wardModel[1]!;
  const row = (t: { sets: ModelSet[] }, label: string) => <tr key={label}><td>{label}</td>{t.sets.map((s) => <td key={s.set} className={s.set === "full" ? "strong" : ""}>{s.pooled.ap?.toFixed(3) ?? "n/a"}</td>)}</tr>;
  return <>
    <div className="verdict"><b className="t">Bottom line</b>It detects same-day risk on years it never saw. It gives no reliable next-day flood lead, and it cannot predict road closures yet.</div>
    <h3>Ward model on held-out years</h3>
    <p className="meta">Average precision: higher is better. The flood base rate is about 0.001.</p>
    <table><thead><tr><th></th>{same.targets[0]!.sets.map((s) => <th key={s.set}>{SET_NAMES[s.set]}</th>)}</tr></thead><tbody>
      {row(same.targets[0]!, "Flood, same day")}{row(same.targets[1]!, "Landslide, same day")}{row(same.targets[2]!, "Fire (control)")}{row(next.targets[0]!, "Flood, next day")}{row(next.targets[1]!, "Landslide, next day")}
    </tbody></table>
    <h3>When vs where</h3>
    <p className="meta">Ward ranking within a day, as AUC. 0.5 is chance. Rain tells you when, not where.</p>
    <table><thead><tr><th></th>{ev.spatial[0]!.sets.map((s) => <th key={s.set}>{SET_NAMES[s.set]}</th>)}</tr></thead><tbody>
      {ev.spatial.map((t) => <tr key={t.target}><td>{t.target === "flood" ? "Flood" : "Landslide"}</td>{t.sets.map((s) => <td key={s.set}>{s.incidentWeightedAuc.toFixed(2)}</td>)}</tr>)}
    </tbody></table>
    <h3>Gauge rules, six monsoons, {ev.eventCount} impact events</h3>
    <table><thead><tr><th>Rule</th><th>Caught</th><th>Missed</th><th>False alarms a season</th></tr></thead><tbody>
      {ev.detector.filter((d) => /warning|danger|>= 80/.test(d.rule)).map((d) => <tr key={d.rule}><td>{d.rule}</td><td>{d.detected}</td><td>{d.missed}</td><td>{d.falseAlarmsPerSeason.toFixed(2)}</td></tr>)}
    </tbody></table>
    <h3>Whiteboard outputs</h3>
    <table><thead><tr><th>Output</th><th>Status</th></tr></thead><tbody>
      {[["Flood and landslide risk", "Built, same day"], ["Public vs authority alerts", "Built, drafts only"], ["Road closure", "Worst-case screen only, needs road labels"], ["Resources: QRT, food, shelter", "Not built, needs shelter and stock data"], ["Evacuation", "Not built, needs safe sites"], ["Outage and grid failures", "Not built, no data to confirm them"]].map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}
    </tbody></table>
  </>;
}

const fc = (features: any[]): any => ({ type: "FeatureCollection", features });
const pt = (lon: number, lat: number, properties: any) => ({ type: "Feature", properties, geometry: { type: "Point", coordinates: [lon, lat] } });
