import { useEffect, useMemo, useRef, useState } from "react";
import { maplibregl } from "./mapsetup.ts";
import { hindcast, type HindcastGeo, type HindcastMeta, type HindcastRun } from "./api.ts";

const PRIMARY = ["Flood", "Inundation", "Heavy Rainfall"];
const C = { closed: "#fb7185", exposed: "#fb923c", stranded: "#c084fc", base: "#5b6f8f" };

/** Animated count-up for headline numbers. */
function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => { let raf = 0; const t0 = performance.now(); const tick = (t: number) => { const k = Math.min(1, (t - t0) / ms); setV(target * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); }, [target, ms]);
  return v;
}
function Kpi({ n, label, tone, delay = 0, fmt }: { n: number; label: string; tone: string; delay?: number; fmt?: (v: number) => string }) {
  const v = useCountUp(n);
  return <div className={`kpi ${tone}`} style={{ animationDelay: `${delay}ms` }}><b>{fmt ? fmt(v) : Math.round(v).toLocaleString()}</b><span>{label}</span></div>;
}

export function HindcastView() {
  const [meta, setMeta] = useState<HindcastMeta | null>(null);
  const [geo, setGeo] = useState<HindcastGeo | null>(null);
  const [run, setRun] = useState<HindcastRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [p, setP] = useState({ closeShare: 0.3, bridgeClosesOnAnyContact: true, degradeMinutes: 10 });
  const [tab, setTab] = useState<"result" | "activity" | "incidents" | "sources">("result");
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const ready = useRef(false);
  const stopPulse = useRef<() => void>(() => {});

  useEffect(() => { (async () => { try { const m = await hindcast.meta(); setMeta(m); if (m.available) setGeo(await hindcast.geo()); } catch (e) { setErr((e as Error).message); } })(); }, []);

  useEffect(() => {
    if (!geo || !el.current) return;
    const m = new maplibregl.Map({
      container: el.current, attributionControl: false,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0a1120" } }] },
      bounds: [[85.284, 27.587], [85.493, 27.788]], fitBoundsOptions: { padding: { left: 340, right: 520, top: 20, bottom: 20 } },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      m.addSource("flood", { type: "geojson", data: geo.flood });
      m.addSource("roads", { type: "geojson", data: geo.roads });
      m.addSource("places", { type: "geojson", data: fc([]) });
      m.addSource("hosp", { type: "geojson", data: fc(geo.hospitals.map((h) => pt(h.lon, h.lat, { n: h.n, f: h.inFlood ? 1 : 0 }))) });
      m.addSource("inc", { type: "geojson", data: fc([]) });
      m.addLayer({ id: "flood", type: "fill", source: "flood", paint: { "fill-color": "#38bdf8", "fill-opacity": 0.32 } });
      m.addLayer({ id: "flood-line", type: "line", source: "flood", paint: { "line-color": "#7dd3fc", "line-width": 1, "line-opacity": 0.8 } });
      m.addLayer({ id: "roads-glow", type: "line", source: "roads", filter: ["in", ["get", "st"], ["literal", ["closed", "stranded"]]],
        paint: { "line-color": ["match", ["get", "st"], "closed", C.closed, C.stranded], "line-width": 9, "line-blur": 6, "line-opacity": 0.6 } });
      m.addLayer({ id: "roads", type: "line", source: "roads", paint: {
        "line-color": ["match", ["get", "st"], "closed", C.closed, "stranded", C.stranded, "exposed", C.exposed, C.base],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, ["match", ["get", "c"], "residential", 0.3, "unclassified", 0.3, 0.9], 15, ["match", ["get", "c"], "residential", 2, 3.5]],
        "line-opacity": ["match", ["get", "st"], "normal", 0.5, 1] } });
      // pulsing halos on hotspots (animated below)
      m.addLayer({ id: "halo", type: "circle", source: "places", filter: ["!=", ["get", "s"], "unaffected"], paint: { "circle-radius": 8, "circle-opacity": 0.4, "circle-color": ["match", ["get", "s"], "cascade-isolated", "#fb7185", "cascade-degraded", "#fb923c", "#38bdf8"], "circle-blur": 0.6 } });
      m.addLayer({ id: "halo-inc", type: "circle", source: "inc", filter: ["in", ["get", "k"], ["literal", ["covered", "missed"]]], paint: { "circle-radius": 8, "circle-opacity": 0.4, "circle-color": ["match", ["get", "k"], "covered", "#34d399", "#fbbf24"], "circle-blur": 0.6 } });
      m.addLayer({ id: "places", type: "circle", source: "places", paint: {
        "circle-radius": ["match", ["get", "s"], "cascade-isolated", 6, "cascade-degraded", 5, "direct", 4, 2.5],
        "circle-color": ["match", ["get", "s"], "cascade-isolated", "#fb7185", "cascade-degraded", "#fb923c", "direct", "#38bdf8", "#64748b"],
        "circle-stroke-color": "#0a1120", "circle-stroke-width": 0.8 } });
      m.addLayer({ id: "hosp", type: "circle", source: "hosp", paint: { "circle-radius": 3.5, "circle-color": ["case", ["==", ["get", "f"], 1], "#fb7185", "#34d399"], "circle-stroke-color": "#0a1120", "circle-stroke-width": 1, "circle-opacity": 0.75 } });
      m.addLayer({ id: "inc", type: "circle", source: "inc", paint: {
        "circle-radius": 6, "circle-color": ["match", ["get", "k"], "covered", "#34d399", "missed", "#fbbf24", "infl", "#38bdf8", "#94a3b8"],
        "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-opacity": ["match", ["get", "k"], "other", 0.25, 1] } });
      for (const id of ["places", "hosp", "inc"]) {
        m.on("click", id, (e: any) => { const pr = e.features?.[0]?.properties; if (pr) new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<b>${pr.n ?? pr.title ?? ""}</b><br>${pr.d ?? ""}`).addTo(m); });
        m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer")); m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
      }
      ready.current = true; (m as any).fire("kready");
      let raf = 0, last = 0;
      const tick = (t: number) => {
        if (t - last > 33) { last = t; const k = (t % 2000) / 2000; for (const id of ["halo", "halo-inc"]) { m.setPaintProperty(id, "circle-radius", 6 + k * 16); m.setPaintProperty(id, "circle-opacity", 0.55 * (1 - k)); } }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick); stopPulse.current = () => cancelAnimationFrame(raf);
    });
    map.current = m;
    return () => { stopPulse.current(); m.remove(); ready.current = false; };
  }, [geo]);

  // Paint results on the map.
  useEffect(() => {
    const m = map.current; if (!m || !geo) return;
    const apply = () => {
      const st = new Map<number, string>();
      if (run) { run.result.exposedEdges.forEach((i) => st.set(i, "exposed")); run.result.strandedEdges.forEach((i) => st.set(i, "stranded")); run.result.closedEdges.forEach((i) => st.set(i, "closed")); }
      (m.getSource("roads") as any).setData({ ...geo.roads, features: geo.roads.features.map((f: any) => ({ ...f, properties: { ...f.properties, st: st.get(f.properties.i) ?? "normal" } })) });
      (m.getSource("places") as any).setData(fc(geo.places.map((q, i) => pt(q.lon, q.lat, { n: q.n, s: run?.result.placeStatus[i] ?? "unaffected",
        d: run ? `status: ${run.result.placeStatus[i]}<br>hospital access: ${run.result.placeT0[i] ?? "none"} min → ${run.result.placeT1[i] ?? "none"} min` : "" }))));
      const cov = new Map(run?.score.incidents.map((i) => [i.id, i]) ?? []);
      (m.getSource("inc") as any).setData(fc(geo.incidents.map((i) => {
        const s = cov.get(i.id);
        const k = !run ? "other" : !s ? "other" : s.zone === "in-flood" ? "infl" : s.coveredByCascade ? "covered" : "missed";
        return pt(i.lon, i.lat, { title: i.title, k, d: `${i.hazard} · ${i.on} · ${Math.round(i.distFloodM)} m from flood extent<br>${lossText(i.loss)}` });
      })));
    };
    if (ready.current) apply(); else (m as any).once("kready", apply);
  }, [run, geo]);

  const go = async () => { setBusy(true); setErr(null); try { setRun(await hindcast.run(p)); setTab("result"); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const s = run?.score;

  if (meta && !meta.available) return <div className="hind-empty"><h2>Kathmandu dataset not prepared</h2><p>Run <code>scripts/prepare_kathmandu.py</code> (see <code>docs/real-data-findings.md</code>), then reload.</p></div>;
  return (
    <div className="hind">
      <aside className="left">
        <h2>Hindcast · Kathmandu valley</h2>
        <p className="hint">The flood is a <b>given input</b> (UNOSAT observed extent, 30 Sep 2024). The model predicts its <b>knock-on effects</b> on a <b>pre-event</b> road network (OSM, 2 Jan 2024), then is scored against independent BIPAD incident reports it never saw.</p>
        <h3>Closure model (assumption)</h3>
        <label className="row"><span>Close road if flooded share ≥</span><select value={p.closeShare} onChange={(e) => setP({ ...p, closeShare: +e.target.value })}>{[0.1, 0.3, 0.5, 0.8].map((v) => <option key={v} value={v}>{v * 100}%</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={p.bridgeClosesOnAnyContact} onChange={(e) => setP({ ...p, bridgeClosesOnAnyContact: e.target.checked })} />Any bridge touching the flood is closed</label>
        <label className="row"><span>"Degraded" if hospital trip +</span><select value={p.degradeMinutes} onChange={(e) => setP({ ...p, degradeMinutes: +e.target.value })}>{[5, 10, 20].map((v) => <option key={v} value={v}>{v} min</option>)}</select></label>
        <div className="actions"><button className="primary" disabled={busy || !geo} onClick={go}>{busy ? "Agents working…" : run ? "Re-run hindcast" : "Run hindcast"}</button></div>
        {err && <div className="warn">{err}</div>}
        <div className="legend2">
          <div><i className="d" style={{ background: "#38bdf855", border: "1px solid #38bdf8" }} /> observed flood extent (given)</div>
          <div><i className="l" style={{ background: C.closed }} /> closed road · <i className="l" style={{ background: C.exposed }} /> exposed, open · <i className="l" style={{ background: C.stranded }} /> dry but stranded</div>
          <div><i className="d" style={{ background: "#38bdf8" }} /> flooded place · <i className="d" style={{ background: "#fb7185" }} /> cascade: no hospital access · <i className="d" style={{ background: "#fb923c" }} /> cascade: degraded</div>
          <div><i className="d" style={{ background: "#34d399" }} /> hospital · <i className="d" style={{ background: "#fb7185" }} /> flooded hospital</div>
          <div>Incidents (BIPAD): <i className="d" style={{ background: "#34d399", border: "1.5px solid #fff" }} /> outside flood &amp; predicted · <i className="d" style={{ background: "#fbbf24", border: "1.5px solid #fff" }} /> outside &amp; missed · <i className="d" style={{ background: "#38bdf8", border: "1.5px solid #fff" }} /> in flood</div>
        </div>
      </aside>
      <main><div ref={el} className="map" />{busy && <div className="scan" />}{!geo && !err && <div className="loading">Loading real network…</div>}</main>
      <aside className="right">
        <nav>{(["result", "activity", "incidents", "sources"] as const).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{{ result: "Result", activity: "Activity", incidents: "Incidents", sources: "Sources" }[t]}</button>)}</nav>
        <div className="panel">
          {tab === "result" && (!run || !s ? <p className="empty">Press <b>Run hindcast</b>. Nothing is precomputed or hard-coded: the numbers below come from the engine running on the real network.</p> : (
            <>
              <div className="warn neutral"><b>Hindcast, not a forecast.</b> The observed (post-event) flood extent is used as the given hazard to test the impact reasoning alone. Incident reports are used only for scoring, after the prediction.</div>
              <h3>What the model predicts</h3>
              <div className="kpis">
                <Kpi n={run.result.counts.exposedEdges!} label="road segments touch the flood" tone="orange" />
                <Kpi n={run.result.counts.closedEdges!} label={`treated as closed (${run.result.counts.closedBridges} bridges)`} tone="red" delay={60} />
                <Kpi n={run.result.counts.direct!} label={`places flooded (of ${run.result.counts.places})`} tone="blue" delay={120} />
                <Kpi n={run.result.counts.cascadeIsolated!} label="dry places: NO hospital access" tone="red" delay={180} />
                <Kpi n={run.result.counts.cascadeDegraded!} label="dry places: trip badly degraded" tone="orange" delay={240} />
                <Kpi n={run.result.counts.strandedEdges!} label="dry roads cut off (cascade)" tone="purple" delay={300} />
              </div>
              <div className="stack" title="Places by status">
                {([["direct", "#38bdf8"], ["cascade-isolated", "#fb7185"], ["cascade-degraded", "#fb923c"], ["unaffected", "#475569"], ["no-baseline", "#1e293b"]] as const).map(([k, col]) => {
                  const n = run.result.placeStatus.filter((x) => x === k).length;
                  return <i key={k} title={`${k}: ${n}`} style={{ width: `${(100 * n) / run.result.placeStatus.length}%`, background: col }} />;
                })}
              </div>
              <p className="meta">{run.result.counts.places} places by status · hospitals flooded / cut off: {run.result.counts.hospitalsFlooded} / {run.result.counts.hospitalsDisconnected} of {run.result.counts.hospitals}</p>
              <h3>Scored against real reports</h3>
              <p className="meta">{s.evaluated} verified BIPAD incidents with reported impact ({PRIMARY.join(", ")}): {s.inFlood} inside the flood extent, <b>{s.outsideFlood} outside it</b> — the ones the flood map alone would not explain.</p>
              <div className="big"><b>{s.outsideCovered}</b> of {s.outsideFlood} outside-flood incidents ({s.outsideRecall === null ? "n/a" : Math.round(s.outsideRecall * 100) + "%"}) lie within {s.options.radiusM} m of a predicted cascade item</div>
              <h3>…but compared with chance</h3>
              <div className="cmp">
                {([["Model (flagged items)", s.outsideCovered, "linear-gradient(90deg,#0ea5e9,#8b5cf6)"], ["Random same-size set", s.randomBaseline.meanCovered, "#64748b"], ["Nearest-the-flood set", s.proximityBaseline.covered, "#475569"]] as const).map(([lab, v, bg]) => (
                  <div className="r" key={lab}><span>{lab}</span><div className="t"><i style={{ width: `${(100 * v) / Math.max(1, s.outsideFlood)}%`, background: bg }} /></div><b>{v.toFixed(1)}</b></div>))}
              </div>
              <p className="meta">out of {s.outsideFlood} · p-value vs random <b>{s.randomBaseline.p.toFixed(3)}</b> · flagged {s.flagged.places} places + {s.flagged.edges} road segments</p>
              <div className={`verdict ${s.outsideCovered > s.proximityBaseline.covered && s.randomBaseline.p < 0.05 ? "ok" : ""}`}><b className="t">Verdict</b>{verdict(s.outsideCovered, s.proximityBaseline.covered, s.randomBaseline.p, s.randomBaseline.meanCovered)}</div>
              <h3>Sensitivity to the closure assumption</h3>
              <table><thead><tr><th>close ≥</th><th>closed</th><th>isolated</th><th>covered/outside</th><th>random</th><th>p</th><th>nearest-flood</th></tr></thead><tbody>
                {run.sensitivity.map((r) => <tr key={r.closeShare}><td>{r.closeShare * 100}%</td><td>{r.closedEdges}</td><td>{r.cascadeIsolated}</td><td>{r.outsideCovered}/{r.outsideFlood}</td><td>{r.randomMean.toFixed(1)}</td><td>{r.p.toFixed(3)}</td><td>{r.proximity}</td></tr>)}</tbody></table>
              <h3>Match radius (exploratory — added after seeing the result)</h3>
              <table><thead><tr><th>radius</th><th>covered/outside</th><th>random</th><th>p</th><th>nearest-flood</th></tr></thead><tbody>
                {run.radiusSensitivity.map((r) => <tr key={r.radiusM}><td>{r.radiusM} m</td><td>{r.outsideCovered}/{r.outsideFlood}</td><td>{r.randomMean.toFixed(1)}</td><td>{r.p.toFixed(3)}</td><td>{r.proximity}</td></tr>)}</tbody></table>
              {s.inFlood === 0 && <p className="meta">Note: <b>none</b> of the reported incidents lie inside the SPOT-6 flood extent — reports sit 200–850 m away. Either the extent under-detects urban flooding (cloud/optical limits) or report points are approximate. Both weaken any point-in-flood comparison.</p>}
              <h3>Out-of-model check: landslides</h3>
              <p className="meta">The model has no landslide physics. {run.landslideCheck.evaluated} landslide incidents with impact; {run.landslideCheck.outsideCovered} of {run.landslideCheck.outsideFlood} outside the flood are near a predicted cascade item (random {run.landslideCheck.randomMean.toFixed(1)}, p={run.landslideCheck.p.toFixed(2)}, nearest-flood {run.landslideCheck.proximity}). Declared in advance; expected to be weak.</p>
              <details open><summary>Honest limits</summary><ul className="plain">
                <li>Small sample ({s.evaluated} incidents); results are indicative, not statistically strong.</li>
                <li>BIPAD points are ward-level reports; a missing report ≠ no impact; the {s.options.radiusM} m match radius is generous.</li>
                <li>Travel speeds, closure thresholds and "hospital = access" are assumptions; places are OSM place nodes, not population.</li>
                <li>OSM tags {run.result.counts.hospitals} features as hospitals (many are small clinics), so hospital access rarely breaks — the "no hospital access" cascade is therefore almost never triggered. A better cascade target (major hospitals, shelters, population) is needed.</li>
                <li>Power, telecom and landslide cascades are not modelled (no data connected).</li>
                <li>The 2 Jan 2024 road network is 9 months old; new or changed roads are missing.</li></ul></details>
            </>))}
          {tab === "activity" && (run ? <ol className="events">{run.events.map((e) => <li key={e.id}><div><span className="agent">{e.agent}</span> → <code>{e.tool}</code></div><div className="sum">{e.summary}</div><div className="ev">{e.evidenceIds.map((x) => <code key={x}>{x}</code>)}</div></li>)}</ol> : <p className="empty">No run yet.</p>)}
          {tab === "incidents" && (s ? <table><thead><tr><th>Incident</th><th>Zone</th><th>Predicted?</th></tr></thead><tbody>{s.incidents.map((i) => <tr key={i.id}><td>{i.title}<br /><small>{i.hazard} · {Math.round(i.distFloodM)} m from flood</small></td><td>{i.zone}</td><td>{i.coveredByCascade === null ? "—" : i.coveredByCascade ? "✔ yes" : "✘ no"}</td></tr>)}</tbody></table> : <p className="empty">Run first.</p>)}
          {tab === "sources" && meta?.provenance && (
            <ul className="plain">
              <li><code>EV-KTM-OSM</code> {meta.provenance.network.source} — snapshot <b>{meta.provenance.network.snapshot}</b> ({meta.provenance.network.phase}), {meta.provenance.network.licence}</li>
              <li><code>EV-KTM-UNOSAT</code> {meta.provenance.hazardInput.source}, observed {meta.provenance.hazardInput.observedOn} — {meta.provenance.hazardInput.phase}; {meta.provenance.hazardInput.licence}</li>
              <li><code>EV-KTM-BIPAD</code> {meta.incidents.source}; window {meta.incidents.window?.join(" → ")}; retrieved {meta.incidents.retrievedAt?.slice(0, 10)}. {meta.incidents.note}</li>
              <li>Maxar pre/post imagery (CC-BY-NC): identified, <b>not yet used</b> by the model or shown here.</li>
              <li>Assumptions: {meta.provenance.network.assumptions.join("; ")}.</li>
              <li>Counts: {Object.entries(meta.provenance.counts).map(([k, v]) => `${k} ${v}`).join(", ")}.</li>
            </ul>)}
        </div>
      </aside>
    </div>
  );
}

const fc = (features: any[]): any => ({ type: "FeatureCollection", features });
const pt = (lon: number, lat: number, properties: any) => ({ type: "Feature", properties, geometry: { type: "Point", coordinates: [lon, lat] } });
const lossText = (l: Record<string, number>) => Object.entries(l).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(", ") || "no loss recorded";
function verdict(cov: number, prox: number, p: number, randMean: number) {
  if (cov > prox && p < 0.05) return "Here it beats both baselines.";
  if (cov > prox) return "Here it beats the proximity baseline but not convincingly against random.";
  if (cov < randMean) return `Here it does NOT beat chance (random sets average ${randMean.toFixed(1)}), so a high percentage is not evidence of skill — the match radius is too coarse for this dense area to discriminate.`;
  if (cov === prox) return "Here it only ties the proximity baseline: network reasoning adds nothing measurable beyond 'near the flood'.";
  return "Here it does WORSE than simply flagging places near the flood.";
}
