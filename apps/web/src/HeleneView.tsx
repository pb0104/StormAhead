import { useEffect, useMemo, useRef, useState } from "react";
import { maplibregl } from "./mapsetup.ts";
import { helene, type HeleneClosure, type HeleneMeta, type HeleneRoads } from "./api.ts";
import { activeAt, draftAlerts, REPLAY_RANGE, summarize } from "../../../packages/analysis/replay.ts";

const HOUR = 3.6e6;
const fmtET = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
const fmtUTC = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z";
const COL = { Closed: "#fb7185", "Partial Access": "#fbbf24" } as Record<string, string>;
const fc = (features: any[]): any => ({ type: "FeatureCollection", features });

function useCountUp(target: number, ms = 600) {
  const [v, setV] = useState(0);
  useEffect(() => { let raf = 0; const t0 = performance.now(); const tick = (t: number) => { const k = Math.min(1, (t - t0) / ms); setV(target * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); }, [target, ms]);
  return v;
}
function Kpi({ n, label, tone }: { n: number; label: string; tone: string }) {
  const v = useCountUp(n);
  return <div className={`kpi ${tone}`}><b>{Math.round(v).toLocaleString()}</b><span>{label}</span></div>;
}

export function HeleneView() {
  const [meta, setMeta] = useState<HeleneMeta | null>(null);
  const [roads, setRoads] = useState<HeleneRoads | null>(null);
  const [recs, setRecs] = useState<HeleneClosure[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [mapIdle, setMapIdle] = useState(false);
  const [t, setT] = useState(Date.parse("2024-09-27T14:00:00Z"));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3);
  const [audience, setAudience] = useState<"authorities" | "public">("authorities");
  const [tab, setTab] = useState("now");
  const [weatherOnly, setWeatherOnly] = useState(true);
  const [county, setCounty] = useState<string>("");
  const [decisions, setDecisions] = useState<Record<number, "approved" | "rejected">>({});
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const ready = useRef(false);
  const stopPulse = useRef<() => void>(() => {});

  useEffect(() => { (async () => { try { const m = await helene.meta(); setMeta(m); if (m.available) { const [r, c] = await Promise.all([helene.roads(), helene.closures()]); setRoads(r); setRecs(c.closures); } } catch (e) { setErr((e as Error).message); } })(); }, []);

  const opts = useMemo(() => ({ weatherOnly, county: county || null }), [weatherOnly, county]);
  const sum = useMemo(() => summarize(recs, t, opts), [recs, t, opts]);
  const active = useMemo(() => activeAt(recs, t, opts) as HeleneClosure[], [recs, t, opts]);
  const alerts = useMemo(() => draftAlerts(recs, t, opts, 12), [recs, t, opts]);
  const edgeGeo = useMemo(() => roads ? (i: number) => { const e = roads.edges[i]!; return [roads.nodes[e[0]]!, ...(e[9] ?? []), roads.nodes[e[1]]!]; } : null, [roads]);
  const spark = useMemo(() => { const bins = new Array(Math.ceil((REPLAY_RANGE.end - REPLAY_RANGE.start) / (6 * HOUR))).fill(0); for (const r of recs) { if (weatherOnly && !["Weather Event", "Road Obstruction", "Emergency Road Work"].includes(r.eventType ?? "")) continue; const k = Math.floor((Date.parse(r.start) - REPLAY_RANGE.start) / (6 * HOUR)); if (k >= 0 && k < bins.length) bins[k]++; } const mx = Math.max(1, ...bins); return bins.map((b) => b / mx); }, [recs, weatherOnly]);

  // playback
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((x) => { const n = x + speed * HOUR / 2; if (n >= REPLAY_RANGE.end) { setPlaying(false); return REPLAY_RANGE.end - HOUR; } return n; }), 250);
    return () => clearInterval(id);
  }, [playing, speed]);

  // map init
  useEffect(() => {
    if (!roads || !el.current) return;
    const m = new maplibregl.Map({
      container: el.current, attributionControl: false,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0a1120" } }] },
      bounds: [[-83.25, 35.30], [-82.25, 35.95]], fitBoundsOptions: { padding: { left: 340, right: 500, top: 20, bottom: 90 } },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      const feats = roads.edges.map((e, i) => ({ type: "Feature", properties: { c: e[4] }, geometry: { type: "LineString", coordinates: [roads.nodes[e[0]], ...(e[9] ?? []), roads.nodes[e[1]]] } }));
      m.addSource("roads", { type: "geojson", data: fc(feats) });
      m.addSource("cl-edges", { type: "geojson", data: fc([]) });
      m.addSource("pts", { type: "geojson", data: fc([]) });
      m.addLayer({ id: "roads", type: "line", source: "roads", paint: {
        "line-color": ["match", ["get", "c"], "motorway", "#8aa4d6", "trunk", "#7d97c8", "primary", "#6f88b8", "secondary", "#5d7399", "#3f5170"],
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, ["match", ["get", "c"], "motorway", 1.6, "trunk", 1.4, "primary", 1.2, "secondary", 0.8, 0.3], 14, ["match", ["get", "c"], "motorway", 4, "trunk", 3.5, "primary", 3, "secondary", 2.4, "tertiary", 2, 1.2]],
        "line-opacity": ["match", ["get", "c"], "residential", 0.5, "unclassified", 0.6, 0.9] } });
      m.addLayer({ id: "cl-glow", type: "line", source: "cl-edges", paint: { "line-color": ["match", ["get", "k"], "Closed", "#fb7185", "#fbbf24"], "line-width": 12, "line-blur": 7, "line-opacity": 0.7 } });
      m.addLayer({ id: "cl-line", type: "line", source: "cl-edges", paint: { "line-color": ["match", ["get", "k"], "Closed", "#fb7185", "#fbbf24"], "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 14, 5] } });
      m.addLayer({ id: "halo", type: "circle", source: "pts", filter: ["==", ["get", "fresh"], 1], paint: { "circle-radius": 8, "circle-opacity": 0.4, "circle-color": ["match", ["get", "k"], "Closed", "#fb7185", "#fbbf24"], "circle-blur": 0.6 } });
      m.addLayer({ id: "pts", type: "circle", source: "pts", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 13, 6], "circle-color": ["match", ["get", "k"], "Closed", "#fb7185", "#fbbf24"], "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
      m.on("click", "pts", (e: any) => { const p = e.features?.[0]?.properties; if (p) new maplibregl.Popup().setLngLat(e.lngLat).setHTML(p.html).addTo(m); });
      m.on("mouseenter", "pts", () => (m.getCanvas().style.cursor = "pointer")); m.on("mouseleave", "pts", () => (m.getCanvas().style.cursor = ""));
      ready.current = true; (m as any).fire("hready");
      const done = (e: any) => { if (e.sourceId === "roads" && m.isSourceLoaded("roads")) { setMapIdle(true); m.off("sourcedata", done); } };
      m.on("sourcedata", done);
      let raf = 0, last = 0;
      const tick = (ts: number) => { if (ts - last > 33) { last = ts; const k = (ts % 1800) / 1800; m.setPaintProperty("halo", "circle-radius", 6 + k * 16); m.setPaintProperty("halo", "circle-opacity", 0.55 * (1 - k)); } raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick); stopPulse.current = () => cancelAnimationFrame(raf);
    });
    map.current = m;
    return () => { stopPulse.current(); m.remove(); ready.current = false; };
  }, [roads]);

  // paint active restrictions for time t
  useEffect(() => {
    const m = map.current; if (!m || !edgeGeo) return;
    const apply = () => {
      const seen = new Map<number, string>();
      for (const r of active) if (r.edge !== null) seen.set(r.edge, seen.get(r.edge) === "Closed" || r.condition === "Closed" ? "Closed" : r.condition);
      (m.getSource("cl-edges") as any).setData(fc([...seen].map(([i, k]) => ({ type: "Feature", properties: { k }, geometry: { type: "LineString", coordinates: edgeGeo(i) } }))));
      (m.getSource("pts") as any).setData(fc(active.map((r) => ({ type: "Feature", properties: {
        k: r.condition, fresh: t - Date.parse(r.start) < 6 * HOUR ? 1 : 0,
        html: `<b>${r.road || "Road"}</b> · ${r.county} Co.<br>${r.condition} · ${r.lanesAffected ?? ""}<br>${r.reason || ""}${r.detour ? `<br><i>Detour: ${r.detour}</i>` : ""}<br><small>${r.location ?? ""}<br>from ${fmtUTC(Date.parse(r.start))}${r.end ? ` to ${fmtUTC(Date.parse(r.end))}` : ""}<br>snapped to road: ${r.match}${r.snapDistM !== null ? ` (${Math.round(r.snapDistM)} m)` : ""}</small>`,
      }, geometry: { type: "Point", coordinates: [r.lon, r.lat] } }))));
    };
    if (ready.current) apply(); else (m as any).once("hready", apply);
  }, [active, edgeGeo, t]);

  const fly = (r: HeleneClosure) => map.current?.flyTo({ center: [r.lon, r.lat], zoom: 12.5, duration: 900 });
  if (meta && !meta.available) return <div className="hind-empty"><h2>Helene dataset not prepared</h2><p>Run <code>node scripts/fetch_tims.mjs</code> then <code>python scripts/prepare_helene.py</code> (see <code>docs/helene-data-audit.md</code>).</p></div>;

  const decide = (id: number, d: "approved" | "rejected") => setDecisions((x) => ({ ...x, [id]: d }));
  const published = alerts.filter((a) => decisions[a.id] === "approved");
  const maxCounty = Math.max(1, ...sum.byCounty.map(([, n]) => n));
  const tabs = audience === "authorities" ? [["now", "Now"], ["closures", "Closures"], ["sources", "Sources"]] : [["alerts", "Alerts"], ["sources", "Sources"]];
  const curTab = tabs.some(([k]) => k === tab) ? tab : tabs[0]![0];

  return (
    <div className="hind">
      <aside className="left">
        <h2>Hurricane Helene · western NC</h2>
        <p className="hint">Replay of <b>reported road restrictions</b> (NCDOT) on a <b>pre-storm</b> road network, Buncombe + Haywood area. Nothing here is sent to anyone.</p>
        <div className="seg">
          <button className={audience === "authorities" ? "active" : ""} onClick={() => { setAudience("authorities"); setTab("now"); }}>Authorities</button>
          <button className={audience === "public" ? "active" : ""} onClick={() => { setAudience("public"); setTab("alerts"); }}>Public</button>
        </div>
        <h3>Filters</h3>
        <label className="check"><input type="checkbox" checked={weatherOnly} onChange={(e) => setWeatherOnly(e.target.checked)} />Storm-related only (hide maintenance, construction)</label>
        <label className="row"><span>County</span><select value={county} onChange={(e) => setCounty(e.target.value)}><option value="">All</option>{(meta?.counties ?? []).map((c) => <option key={c}>{c}</option>)}</select></label>
        <div className="legend2">
          <div><i className="l" style={{ background: "#fb7185" }} /> closed · <i className="l" style={{ background: "#fbbf24" }} /> partial access</div>
          <div>Pulsing ring = started in the last 6 hours of replay time</div>
          <div>Road lines: <i className="l" style={{ background: "#8aa4d6" }} /> highways · <i className="l" style={{ background: "#3f5170" }} /> local roads</div>
        </div>
        <div className="warn">Timeline is a <b>reconstruction</b>: NCDOT entered these records ≥ 13 days after the storm, so this is not what officials saw live.</div>
      </aside>

      <main>
        <div ref={el} className="map" />
        {(!roads || !mapIdle) && !err && <div className="maploading"><div className="spin" />Drawing {roads ? roads.edges.length.toLocaleString() : "…"} road segments…</div>}
        <div className="timebar">
          <button className="primary" onClick={() => { if (t >= REPLAY_RANGE.end - HOUR) setT(REPLAY_RANGE.start); setPlaying((p) => !p); }}>{playing ? "❚❚" : "▶"}</button>
          <div className="tb-mid">
            <div className="spark">{spark.map((h, i) => <i key={i} style={{ height: `${8 + h * 28}px` }} />)}</div>
            <input type="range" min={REPLAY_RANGE.start} max={REPLAY_RANGE.end - HOUR} step={HOUR} value={t} onChange={(e) => { setPlaying(false); setT(+e.target.value); }} />
          </div>
          <div className="tb-time"><b>{fmtET(t)}</b><span>{fmtUTC(t)}</span></div>
          <select value={speed} onChange={(e) => setSpeed(+e.target.value)} title="Replay speed">{[1, 3, 8, 24].map((s) => <option key={s} value={s}>{s * 2}h/s</option>)}</select>
        </div>
      </main>

      <aside className="right">
        <nav>{tabs.map(([k, label]) => <button key={k} className={curTab === k ? "active" : ""} onClick={() => setTab(k as string)}>{label}</button>)}</nav>
        <div className="panel">
          {err && <div className="warn">{err}</div>}
          {curTab === "now" && (
            <>
              <div className="warn neutral"><b>Reported restrictions, not predictions.</b> Showing what NCDOT records say was restricted at the replay time. Prediction comes later and will be scored against these records.</div>
              <div className="kpis">
                <Kpi n={sum.closed} label="roads closed now" tone="red" />
                <Kpi n={sum.partial} label="partial access" tone="orange" />
                <Kpi n={sum.newLast6h} label="new in last 6 h" tone="purple" />
                <Kpi n={sum.known} label="reported so far" tone="blue" />
                <Kpi n={sum.reopened} label="already reopened" tone="blue" />
                <Kpi n={active.filter((a) => a.edge === null).length} label="not matched to a road" tone="orange" />
              </div>
              <h3>Active restrictions by county</h3>
              {sum.byCounty.length === 0 ? <p className="empty">Nothing reported yet at this time.</p> : <div className="cmp">{sum.byCounty.slice(0, 10).map(([c, n]) => (
                <div className="r" key={c}><span>{c}</span><div className="t"><i style={{ width: `${(100 * n) / maxCounty}%`, background: "linear-gradient(90deg,#fb7185,#a78bfa)" }} /></div><b>{n}</b></div>))}</div>}
              <h3>Newest (QRT attention)</h3>
              <ul className="plain">{[...active].sort((a, b) => Date.parse(b.start) - Date.parse(a.start)).slice(0, 6).map((r) => (
                <li key={r.id} className="clickable" onClick={() => fly(r)}><b>{r.road}</b> · {r.county} — {r.reason || r.lanesAffected}{r.detour ? <><br /><i>Detour: {r.detour}</i></> : <><br /><i style={{ color: "#fda4af" }}>no detour published</i></>}</li>))}</ul>
            </>
          )}
          {curTab === "closures" && (
            <>
              <p className="meta">{active.length} active restriction(s) at {fmtET(t)}. Click a row to fly to it.</p>
              <table><thead><tr><th>Road</th><th>County</th><th>Condition</th><th>Since</th></tr></thead><tbody>
                {[...active].sort((a, b) => Date.parse(b.start) - Date.parse(a.start)).slice(0, 150).map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => fly(r)} title={r.reason}><td>{r.road}<br /><small>{r.reason.slice(0, 60)}</small></td><td>{r.county}</td><td style={{ color: COL[r.condition] ?? "#cbd5e1" }}>{r.condition}</td><td><small>{fmtET(Date.parse(r.start)).replace(" ET", "")}</small></td></tr>))}
              </tbody></table>
            </>
          )}
          {curTab === "alerts" && (
            <>
              <div className="warn neutral"><b>Draft public alerts — a person must approve.</b> Written by a simple rule-based drafter from NCDOT records started in the last 12 replay-hours. <b>Replay only: nothing is ever sent.</b></div>
              <p className="meta">{alerts.length} draft(s) at {fmtET(t)} · {published.length} approved (simulated)</p>
              {alerts.length === 0 && <p className="empty">No new restrictions in the last 12 hours of replay time. Move the slider.</p>}
              {alerts.map((a) => (
                <div key={a.id} className={`card alert ${decisions[a.id] ?? ""}`} style={{ cursor: "default" }}>
                  <div className="card-h"><b style={{ color: a.severity === "closed" ? "#fb7185" : "#fbbf24" }}>{a.severity === "closed" ? "ROAD CLOSED" : "PARTIAL ACCESS"}</b><small>{fmtET(Date.parse(a.start))}</small></div>
                  <p style={{ margin: "6px 0" }}>{a.text}</p>
                  {decisions[a.id] ? <span className={`status ${decisions[a.id] === "approved" ? "s-approved" : "s-rejected"}`}>{decisions[a.id] === "approved" ? "Approved — would publish (simulated)" : "Rejected"}</span> : (
                    <div className="actions" style={{ margin: 0 }}><button className="primary" onClick={() => decide(a.id, "approved")}>Approve</button><button onClick={() => decide(a.id, "rejected")}>Reject</button></div>)}
                </div>))}
            </>
          )}
          {curTab === "sources" && meta?.provenance && (
            <>
              <ul className="plain">
                <li><b>Closures:</b> {meta.provenance.closures.source}; retrieved {meta.provenance.closures.retrievedAt.slice(0, 10)}. {meta.provenance.closures.disclaimer}</li>
                <li><b>Roads:</b> {meta.provenance.network.source}, snapshot <b>{meta.provenance.network.snapshot}</b> ({meta.provenance.network.phase}); {meta.provenance.network.licence}.</li>
                <li><b>Matching closures to roads:</b> {Object.entries(meta.byMatch ?? {}).map(([k, v]) => `${k} ${v}`).join(", ")} (road number first, else nearest road ≤ {meta.provenance.snap.maxSnapM} m).</li>
                <li><b>Records:</b> {meta.records} in area; by condition {Object.entries(meta.byCondition ?? {}).map(([k, v]) => `${k} ${v}`).join(", ")}.</li>
              </ul>
              <h3>Caveats</h3>
              <ul className="plain">{(meta.caveats ?? []).map((c, i) => <li key={i}>{c}</li>)}</ul>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
