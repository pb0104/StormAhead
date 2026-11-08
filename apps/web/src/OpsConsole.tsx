import { useEffect, useMemo, useRef, useState } from "react";
import { MapStage, type Rec, type Vis } from "./MapStage.tsx";
import { CommandRail } from "./CommandRail.tsx";
import { StatusStrip, type StripItem } from "./StatusStrip.tsx";
import { ContextDrawer, type Done } from "./ContextDrawer.tsx";
import { DetailsDialog } from "./DetailsDialog.tsx";
import { PhotorealView, savedToken } from "./PhotorealView.tsx";
import { StreetView } from "./StreetView.tsx";
import { distKm } from "./affected.ts";
import { ops } from "./api.ts";
import { assess, buildingAdvice, fetchBuildings, ROLE_COLOR, toEntity, type BuildingLayer } from "./buildings.ts";
import { SwipeHandle } from "./SwipeHandle.tsx";
import { fetchScorecard, fetchVerification, type Scorecard, type Verification } from "./api.ts";
import { mergeBipadIntoScene } from "./mergeBipad.ts";
import { MERGED_OFF, MERGED_ON } from "./mergedPack.ts";
import { OBSERVED_IN, WEATHER, whenText } from "./real/ops.ts";
import { AreaFeedPanel, SocialFeed } from "./SocialFeed.tsx";
import type { AssessmentResult, AtmosphereSnapshot, Entity, SceneSnapshot, TerrainResult, Weather } from "../../../packages/ports/index.ts";

/**
 * Authority ops console. Scene / assessment / tiles from the modular API; BIPAD facilities + Open-Meteo
 * observed rain overlay the scene on the client. Building footprints from GET /api/buildings.
 */
const DEFAULT_VIS: Vis = {
  terrain: true, roads: true, towers: false, weather: true, atmosphere: false, dams: true, social: true, buildings: true, schools: true, airports: true, helipads: true, army: true,
  closures: true, flood: true, runoff: true, landslides: true, qrt: true, food: true, shelter: true, outages: true, alerts: true,
  shelterBuildings: true,
};
const TERRAIN_IDLE: TerrainResult = { status: "idle", depth0: [], medianDepth: 0, note: "Terrain agent has not run yet." };
const WEATHER_IDLE: Weather = { inches: OBSERVED_IN, mm: OBSERVED_IN * 25.4, lowIn: Math.max(4, OBSERVED_IN - 2), highIn: OBSERVED_IN + 2, peakMmH: WEATHER.peakMmH, label: "Heavy" };

export function OpsConsole() {
  const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches;
  const [scene, setScene] = useState<SceneSnapshot | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
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
  const [street, setStreet] = useState(false);
  const [token, setToken] = useState(savedToken);
  const view3d = mode === "3d";
  const [hover, setHover] = useState<string | null>(null);
  const [flying, setFlying] = useState(false);
  const [rain, setRain] = useState(OBSERVED_IN);
  const [assessResult, setAssessResult] = useState<AssessmentResult | null>(null);
  const [assessBusy, setAssessBusy] = useState(false);
  const [atmosphere, setAtmosphere] = useState<AtmosphereSnapshot | null>(null);
  const [bldgLayer, setBldgLayer] = useState<BuildingLayer | null>(null);
  const [spot, setSpot] = useState<[number, number] | null>(null);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [verify, setVerify] = useState<Verification | null>(null);
  /** Before/after imagery swipe: null = off, otherwise the handle position as a fraction of map width. */
  const [swipe, setSwipe] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const of = (k: string) => (scene?.entities ?? []).filter((e) => e.kind === k);
  const TOTAL = of("closure").length;

  useEffect(() => () => window.clearInterval(timer.current), []);
  useEffect(() => { fetchBuildings().then(setBldgLayer); }, []);
  // How the REAL engine scored against withheld incident reports: the numbers (Details > Evaluation) and the
  // same thing as geography (the Verification overlay). Both degrade to nothing when the dataset is absent.
  useEffect(() => { fetchScorecard().then(setScorecard); }, []);
  useEffect(() => { fetchVerification().then(setVerify); }, []);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [s, atm] = await Promise.all([
          ops.scene(),
          ops.atmosphere().catch(() => null),
        ]);
        if (dead) return;
        // Adapter scene (OSM + demo closures) then BIPAD real facilities / gauges / alerts / rain grid.
        setScene(mergeBipadIntoScene(s));
        setRain(OBSERVED_IN);
        if (atm) setAtmosphere(atm);
      } catch (e) {
        if (!dead) setLoadErr((e as Error).message);
      }
    })();
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    if (!scene) return;
    let dead = false;
    setAssessBusy(true);
    const t = window.setTimeout(async () => {
      try {
        const a = await ops.assessment(rain, stage);
        if (!dead) setAssessResult(a);
      } catch {
        if (!dead) setAssessResult(null);
      } finally {
        if (!dead) setAssessBusy(false);
      }
    }, 200);
    return () => { dead = true; window.clearTimeout(t); };
  }, [scene, rain, stage]);

  const weather = assessResult?.weather ?? { ...WEATHER_IDLE, inches: rain, mm: rain * 25.4 };
  const terrain = assessResult?.terrain ?? (assessBusy ? { ...TERRAIN_IDLE, status: "loading" as const, note: "Terrain agent is reading elevation tiles…" } : TERRAIN_IDLE);
  const depths = assessResult?.depths ?? [];
  const floodFc = assessResult?.floodFc ?? { type: "FeatureCollection" as const, features: [] };
  const flowUrl = assessResult?.flow ? `data:image/png;base64,${assessResult.flow.imagePngBase64}` : null;
  const field = assessResult?.flow ? {
    grid: assessResult.flow.grid,
    gx: Float32Array.from(assessResult.flow.field.gx),
    gy: Float32Array.from(assessResult.flow.field.gy),
    acc: Float32Array.from(assessResult.flow.field.acc),
  } : null;
  const flowText = !ran
    ? "Flow agent: run the assessment to route the rain downhill."
    : assessBusy || !assessResult
      ? "Flow agent is routing the rain downhill…"
      : assessResult.flowText;
  const wet = assessResult?.wet ?? 0;
  const deepest = assessResult?.deepest ?? 0;
  const floodPolyCount = scene?.floodPolys.length ?? 0;

  // A building counts as cut off when it sits close to a stranded pocket road.
  const pocketPts = useMemo(() => of("pocket").flatMap((p) => (p.geom.type === "MultiLineString" ? p.geom.coordinates.flat() : [])), [scene]);
  const isCutOff = useMemo(() => (lon: number, lat: number) =>
    pocketPts.some((c) => Math.hypot((c[0]! - lon) * 98.6, (c[1]! - lat) * 110.6) < 0.35), [pocketPts]);
  const assessed = useMemo(
    () => (bldgLayer && scene ? assess(bldgLayer.list, depths, scene.floodPolys, isCutOff) : []),
    [bldgLayer, depths, scene, isCutOff],
  );
  const bldgFc = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: assessed.filter((b) => b.role !== "none").map((b) => ({
      type: "Feature" as const,
      properties: { id: `BL-${b.id}`, color: ROLE_COLOR[b.role], floors: b.f, role: b.role },
      geometry: { type: "Polygon" as const, coordinates: [b.ring] },
    })),
  }), [assessed]);
  // Separate point layer for the markers: a circle layer on polygon geometry would draw one circle per vertex.
  const bldgPts = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: assessed.filter((b) => b.role !== "none").map((b) => ({
      type: "Feature" as const,
      properties: { id: `BL-${b.id}`, color: ROLE_COLOR[b.role], role: b.role },
      geometry: { type: "Point" as const, coordinates: b.at },
    })),
  }), [assessed]);
  const buildingById = useMemo(() => new Map(assessed.filter((b) => b.role !== "none").map((b) => { const e = toEntity(b); return [e.id, e] as const; })), [assessed]);
  const evacuate = assessed.filter((b) => b.role === "at-risk-evacuate").length;
  const refuges = assessed.filter((b) => b.role === "refuge");

  const run = () => {
    if (busy || !scene) return;
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
  const toggle = (k: string) => {
    if (k === "swipe") {
      setSwipe((v) => {
        if (v === null) {
          setVis((vis) => ({ ...vis, ...MERGED_ON }));
          return 0.5;
        }
        setVis((vis) => ({ ...vis, ...MERGED_OFF }));
        return null;
      });
      return;
    }
    setVis((v) => {
      const next = !v[k];
      if (k === "atmosphere" && next && !atmosphere) {
        ops.atmosphere().then((a) => setAtmosphere(a)).catch(() => { /* keep off-data */ });
      }
      return { ...v, [k]: next };
    });
  };
  const select = (e: Entity | null) => { setFlying(false); setPhoto(false); setSelected(e); setSpot(null); if (e && narrow) setRailOpen(false); };

  const advice = selected?.kind === "building"
    ? buildingAdvice(selected)
    : selected && scene ? scene.advice[selected.id] : undefined;
  const acts = advice?.actions ?? [];
  const why = advice?.reasons ?? [];

  const recs = useMemo<Rec[]>(() => {
    if (!selected || !scene) return [];
    const byId = new Map(scene.entities.map((e) => [e.id, e]));
    const word: Record<string, string> = { qrt: "", food: "Food ", shelter: "Shelter ", grid: "Crew ", alert: "Alert ", air: "Airlift ", army: "Army " };
    return acts.flatMap((a) => {
      const t = a.targetId ? byId.get(a.targetId) ?? buildingById.get(a.targetId) : undefined;
      return t && t.id !== selected.id
        ? [{ id: a.id, kind: a.kind, at: t.at, label: `${word[a.kind] ?? ""}${t.id} · ${distKm(selected.at, t.at).toFixed(1)} km`, target: t.id }]
        : [];
    });
  }, [selected, scene, acts, buildingById]);

  const linkedIds = useMemo(() => recs.flatMap((r) => (r.target ? [r.target] : [])), [recs]);
  const closed = of("closure").filter((c) => (c.stage ?? 0) <= stage).length;
  const strip: StripItem[] = [
    { key: "closures", label: "closed roads", value: ran ? (revealN >= TOTAL ? closed : Math.min(revealN, closed)) : null },
    { key: "pockets", label: "cut-off pockets", value: ran && pockets ? of("pocket").length : null },
    { key: "landslides", label: "landslide zones", value: ran ? of("landslide").length : null },
    { key: "schools", label: "schools at risk", value: ran ? of("school").filter((s) => s.props.risk !== "ok").length : null },
    { key: "hospitals", label: "hospitals at risk", value: ran ? of("hospital").filter((h) => h.props.access === "lost" || h.props.access === "degraded").length : null },
    { key: "outages", label: "night-lights outages", value: ran ? of("outage").length : null },
    ...(bldgLayer ? [{ key: "evacuate", label: "buildings to evacuate", value: ran ? evacuate : null }] : []),
  ];
  const hint = ran && !busy && !selected;
  const kindLabel = { ...(scene?.kindLabel ?? {}), building: "Building" };

  if (loadErr) return <div className="shell" style={{ padding: 40 }}><p>Could not load scene: {loadErr}</p></div>;
  if (!scene) return <div className="shell" style={{ padding: 40, color: "#8d9db6" }}>Loading ops console…</div>;

  return (
    <div className="shell">
      <MapStage verify={verify} swipe={swipe} buildingPts={bldgPts} scene={scene} ran={ran} revealN={revealN} showPockets={pockets} stage={stage} vis={vis} focus={focus} selected={selected} recs={recs} hover={hover} buildings={bldgFc} buildingById={buildingById} onSelect={select} onMapClick={setSpot} pick={spot} compact={narrow} flood={floodFc} flowUrl={flowUrl} field={field} rainIn={rain} view3d={view3d} flying={flying} onFlyEnd={() => setFlying(false)} atmosphere={atmosphere} />
      {photo && selected && <PhotorealView token={token} setToken={setToken} ran={ran} selected={selected} depths={depths} floodPolys={scene.floodPolys} entities={scene.entities} linked={linkedIds} onClose={() => setPhoto(false)} />}
      {street && selected && <StreetView selected={selected} onClose={() => setStreet(false)} />}
      <StatusStrip items={strip} focus={focus} setFocus={pick} openDetails={() => setDetails(true)} mode={mode} setMode={setMode} />
      <CommandRail swipeOn={swipe !== null} open={railOpen} setOpen={setRailOpen} vis={vis} toggle={toggle} stage={stage} setStage={setStage} ran={ran} busy={busy} run={run}
        rain={rain} setRain={setRain} weather={weather} terrain={terrain} wet={wet} total={floodPolyCount} deepest={deepest} flowText={flowText}
        legendOpen={legendOpen} setLegendOpen={setLegendOpen} actionsDone={Object.keys(done).length} openDetails={() => setDetails(true)} />
      {swipe !== null && <SwipeHandle value={swipe} onChange={setSwipe} onClose={() => toggle("swipe")} patches={floodPolyCount} />}
      {vis.verify && verify && (
        <div className="verifybar" role="status">
          <strong>Verification overlay.</strong> Scores the <em>real</em> hindcast engine against {verify.summary.evaluatedIncidents} withheld
          incident reports &mdash; <em>not</em> the demo closures on this map.{" "}
          <i className="vk hit" />hit <i className="vk miss" />missed <i className="vk fa" />false alarm <i className="vk pt" />reported incident
          <button className="link" onClick={() => setDetails(true)}>What does this mean?</button>
        </div>
      )}
      {hint && !vis.verify && !spot && <div className="hint" role="status">Select a closed road to see where to send response, or click anywhere to see posts from that spot.</div>}
      <ContextDrawer key={selected?.id ?? "none"} onHover={setHover} onFly={startFly} onPhoto={() => { setFlying(false); setStreet(false); setPhoto(true); }} onStreet={() => { setFlying(false); setPhoto(false); setStreet(true); }} e={selected} done={done} setDone={setDone} onClose={() => { setFlying(false); setPhoto(false); setStreet(false); setSelected(null); }} reasons={why} actions={acts} kindLabel={kindLabel} feed={selected ? <SocialFeed at={selected.at} compact /> : null} />
      <AreaFeedPanel at={selected ? null : spot} onClose={() => setSpot(null)} />
      <DetailsDialog open={details} onClose={() => setDetails(false)} done={done} scorecard={scorecard} agentLines={[`Weather agent (real, Open-Meteo ECMWF IFS 9 km): heaviest 24 h ${WEATHER.max24hMm} mm valley average, ending ${whenText(WEATHER.max24hEnd)}; peak ${WEATHER.peakMmH} mm/h at ${whenText(WEATHER.peakAt)}. Depth model is using ${weather.inches} in (${rain === OBSERVED_IN ? "observed" : "what-if"}).`, `Terrain agent (real elevation tiles): ${terrain.note}`, `${flowText}`, `Flood depth model (illustrative): ${wet} of ${floodPolyCount} observed patches wet at this point in time, deepest ${deepest.toFixed(1)} m.`,
        bldgLayer
          ? `Shelter agent (REAL buildings, OpenStreetMap 2 Jan 2024): ${bldgLayer.list.length} shelter-relevant footprints. At this forecast ${assessed.filter((b) => b.role === "at-risk-vertical").length} flooded buildings keep floors above the water, ${evacuate} have none and must be evacuated, and ${refuges.length} dry upper-floor buildings in cut-off areas could take about ${refuges.reduce((s, b) => s + (b.capacity ?? 0), 0).toLocaleString("en-US")} people. ${bldgLayer.list.filter((b) => b.f === null).length} have no tagged height and get no judgement.`
          : "Shelter agent: real building footprints are not loaded (run scripts/fetch_buildings.mjs and start the API)."]} />
    </div>
  );
}
