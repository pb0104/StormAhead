import { useEffect, useMemo, useRef, useState } from "react";
import { MapStage, type Rec, type Vis } from "./MapStage.tsx";
import { CommandRail } from "./CommandRail.tsx";
import { StatusStrip, type StripItem } from "./StatusStrip.tsx";
import { ContextDrawer, type Done } from "./ContextDrawer.tsx";
import { DetailsDialog } from "./DetailsDialog.tsx";
import { PhotorealView, savedToken } from "./PhotorealView.tsx";
import { actions, distKm } from "./mock/advice.ts";
import { FLOOD_POLYS, OF, type Entity } from "./mock/demo.ts";
import { depthImage, runoff, slopeField, type Runoff } from "./hydro.ts";
import { floodDepths, STAGE_FRACTION, TERRAIN_IDLE, terrainAgent, weatherAgent, type Terrain } from "./agents.ts";

/**
 * Authority ops console, DEMO build. Every layer except OSM road geometry and the satellite base is mock.
 * The research hindcast view (HindcastView.tsx) is still in the repo but is no longer the primary screen.
 */
const DEFAULT_VIS: Vis = {
  terrain: true, roads: true, towers: false, weather: true, dams: false, social: false, radio: false, buildings: true, schools: true, airports: true, army: true,
  closures: true, flood: true, runoff: true, landslides: true, qrt: false, food: false, shelter: false, outages: true, alerts: false,
};
const TOTAL = OF("closure").length;

export function App() {
  const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches;
  const [vis, setVis] = useState<Vis>(DEFAULT_VIS);
  const [stage, setStage] = useState(3);
  const [ran, setRan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revealN, setRevealN] = useState(0);
  const [pockets, setPockets] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [done, setDone] = useState<Done>({});
  const [railOpen, setRailOpen] = useState(!narrow);
  const [legendOpen, setLegendOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const [photo, setPhoto] = useState(false);
  const [token, setToken] = useState(savedToken);
  const view3d = mode === "3d";
  const [hover, setHover] = useState<string | null>(null);
  const [flying, setFlying] = useState(false);
  const [rain, setRain] = useState(10);
  const [terrain, setTerrain] = useState<Terrain>(TERRAIN_IDLE);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearInterval(timer.current), []);
  useEffect(() => { setTerrain({ ...TERRAIN_IDLE, status: "loading", note: "Terrain agent is reading elevation tiles…" }); terrainAgent().then(setTerrain); }, []);
  const [flow, setFlow] = useState<{ url: string; r: Runoff } | null>(null);
  const [flowBusy, setFlowBusy] = useState(false);
  const field = useMemo(() => (terrain.grid ? slopeField(terrain.grid) : null), [terrain]);
  useEffect(() => {
    if (!terrain.grid || !field || !ran) { setFlow(null); return; }
    let dead = false;
    setFlowBusy(true);
    const t = window.setTimeout(async () => {
      const r = await runoff(terrain.grid!, rain * 25.4 * (STAGE_FRACTION[stage] ?? 1), () => dead, field);
      if (dead || !r) return;
      setFlow({ url: depthImage(terrain.grid!, r.depth), r }); setFlowBusy(false);
    }, 250);
    return () => { dead = true; window.clearTimeout(t); };
  }, [terrain, field, rain, stage, ran]);
  const flowText = !terrain.grid ? "Flow agent needs the elevation grid, which could not be built." : !ran ? "Flow agent: run the assessment to route the rain downhill." : flowBusy || !flow ? "Flow agent is routing the rain downhill…" : `Flow agent: water drains off slopes and pools in about ${flow.r.pooledKm2.toFixed(1)} km² of low ground, typically about ${flow.r.maxDepth.toFixed(1)} m deep.`;
  const weather = useMemo(() => weatherAgent(rain), [rain]);
  const depths = useMemo(() => floodDepths(terrain, rain, STAGE_FRACTION[stage] ?? 1), [terrain, rain, stage]);
  const floodFc = useMemo(() => ({ type: "FeatureCollection" as const, features: FLOOD_POLYS.map((p, i) => ({ type: "Feature" as const, properties: { d: Math.round((depths[i] ?? 0) * 100) / 100, i }, geometry: { type: "Polygon" as const, coordinates: [p.ring] } })) }), [depths]);
  const wet = depths.filter((d) => d > 0).length, deepest = Math.max(0, ...depths);

  const run = () => {
    if (busy) return;
    window.clearInterval(timer.current);
    setBusy(true); setRan(true); setSelected(null); setPockets(false); setRevealN(0);
    if (narrow) setRailOpen(false);
    let n = 0;
    timer.current = window.setInterval(() => {
      n += 1; setRevealN(n);
      if (n >= TOTAL) { window.clearInterval(timer.current); window.setTimeout(() => { setPockets(true); setBusy(false); }, 450); }
    }, 170);
  };

  const pick = (k: string | null) => { setFocus(k); if (k && !ran && !busy) run(); };
  const startFly = () => { if (!selected) return; setMode("3d"); window.setTimeout(() => setFlying(true), view3d ? 50 : 1500); };
  const toggle = (k: string) => setVis((v) => ({ ...v, [k]: !v[k] }));
  const select = (e: Entity | null) => { setFlying(false); setPhoto(false); setSelected(e); if (e && narrow) setRailOpen(false); };
  const recs = useMemo<Rec[]>(() => {
    if (!selected) return [];
    const word: Record<string, string> = { qrt: "", food: "Food ", shelter: "Shelter ", grid: "Crew ", alert: "Alert ", air: "Airlift ", army: "Army " };
    return actions(selected).flatMap((a) => (a.target && a.target.id !== selected.id ? [{ id: a.id, kind: a.kind, at: a.target.at, label: `${word[a.kind] ?? ""}${a.target.id} · ${distKm(selected.at, a.target.at).toFixed(1)} km` }] : []));
  }, [selected]);

  const linkedIds = useMemo(() => recs.flatMap((r) => (r.target ? [r.target] : [])), [recs]);
  const closed = OF("closure").filter((c) => (c.stage ?? 0) <= stage).length;
  const strip: StripItem[] = [
    { key: "closures", label: "closed roads", value: ran ? (revealN >= TOTAL ? closed : Math.min(revealN, closed)) : null },
    { key: "pockets", label: "cut-off pockets", value: ran && pockets ? OF("pocket").length : null },
    { key: "landslides", label: "landslide zones", value: ran ? OF("landslide").length : null },
    { key: "schools", label: "schools at risk", value: ran ? OF("school").filter((s) => s.props.risk !== "ok").length : null },
    { key: "hospitals", label: "hospitals at risk", value: ran ? OF("hospital").filter((h) => h.props.access !== "ok").length : null },
    { key: "outages", label: "grid outages", value: ran ? OF("outage").length : null },
  ];
  const hint = ran && !busy && !selected;

  return (
    <div className="shell">
      <MapStage ran={ran} revealN={revealN} showPockets={pockets} stage={stage} vis={vis} focus={focus} selected={selected} recs={recs} hover={hover} onSelect={select} compact={narrow} flood={floodFc} flowUrl={flow?.url ?? null} field={field && terrain.grid ? { grid: terrain.grid, gx: field.gx, gy: field.gy, acc: field.acc } : null} rainIn={rain} view3d={view3d} flying={flying} onFlyEnd={() => setFlying(false)} />
      {photo && selected && <PhotorealView token={token} setToken={setToken} ran={ran} selected={selected} depths={depths} linked={linkedIds} onClose={() => setPhoto(false)} />}
      <StatusStrip items={strip} focus={focus} setFocus={pick} openDetails={() => setDetails(true)} mode={mode} setMode={setMode} />
      <CommandRail open={railOpen} setOpen={setRailOpen} vis={vis} toggle={toggle} stage={stage} setStage={setStage} ran={ran} busy={busy} run={run}
        rain={rain} setRain={setRain} weather={weather} terrain={terrain} wet={wet} total={FLOOD_POLYS.length} deepest={deepest} flowText={flowText}
        legendOpen={legendOpen} setLegendOpen={setLegendOpen} actionsDone={Object.keys(done).length} openDetails={() => setDetails(true)} />
      {hint && <div className="hint" role="status">Select a closed road to see where to send response.</div>}
      <ContextDrawer key={selected?.id ?? "none"} onHover={setHover} onFly={startFly} onPhoto={() => { setFlying(false); setPhoto(true); }} e={selected} done={done} setDone={setDone} onClose={() => { setFlying(false); setPhoto(false); setSelected(null); }} />
      <DetailsDialog open={details} onClose={() => setDetails(false)} done={done} agentLines={[`Weather agent (mock forecast): ${weather.label.toLowerCase()} rain, ${weather.inches} in (${Math.round(weather.mm)} mm) in 24 h, range ${weather.lowIn} to ${weather.highIn} in, peak about ${weather.peakMmH} mm/h.`, `Terrain agent (real elevation tiles): ${terrain.note}`, `${flowText}`, `Flood depth model (illustrative): ${wet} of ${FLOOD_POLYS.length} observed patches wet at this point in time, deepest ${deepest.toFixed(1)} m.`]} />
    </div>
  );
}
