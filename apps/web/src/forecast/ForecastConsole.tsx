/**
 * StormAhead forecast console. The screen is the map and one prompt. The operator asks ("How do the next 15 days look?"),
 * picks the factors to include, and watches the matching agents work in parallel. When they finish, the coordinator fuses
 * their alerts, the LLM (StackAI) writes the situation report, and the map plays the window back: rain, water, closures and
 * alert pins. Nothing is sent: every output is a draft for a person to approve.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { MapStage, type MapAlertPin, type Rec, type Vis } from "../MapStage.tsx";
import { ContextDrawer, type Done } from "../ContextDrawer.tsx";
import { DetailsDialog } from "../DetailsDialog.tsx";
import { PhotorealView, savedToken } from "../PhotorealView.tsx";
import { StreetView } from "../StreetView.tsx";
import { SocialFeed } from "../SocialFeed.tsx";
import { distKm } from "../affected.ts";
import { fetchScorecard, ops, type Scorecard } from "../api.ts";
import { assess, buildingAdvice, fetchBuildings, ROLE_COLOR, toEntity, type BuildingLayer } from "../buildings.ts";
import { mergeBipadIntoScene } from "../mergeBipad.ts";
import { OBSERVED_IN } from "../real/ops.ts";
import type { AssessmentResult, AtmosphereSnapshot, Entity, SceneSnapshot } from "../../../../packages/ports/index.ts";
import { AgentBoard, type AgentState } from "./AgentBoard.tsx";
import { ReportPanel } from "./ReportPanel.tsx";
import { RainOverlay } from "./RainOverlay.tsx";
import { Timeline } from "./Timeline.tsx";
import { Icon } from "./Icon.tsx";
import { Eq, RadioPanel, useRadio } from "./RadioPanel.tsx";
import { ActionsPanel, FollowUp, UpdateConfirm } from "./ActionLog.tsx";
import { actionsApi, locationLabel, looksLikeUpdate, type ActionsView, type Coverage, type NextRec, type Proposal } from "./actionsApi.ts";
import { getFactors, getIntent, streamForecast, type AgentResult, type Combined, type Factors, type ForecastEvent, type Intent, type Window } from "./api.ts";
import "./forecast.css";

type Phase = "idle" | "scoping" | "running" | "done";

/** Map layers each agent turns on when it finishes: impact only. Asset layers (sites, schools, cells…) stay in Layers. */
const FACTOR_VIS: Record<string, string[]> = {
  weather: [], rivers: ["rivers"], terrain: ["flood", "runoff", "rivers"], satellite: ["flood"],
  roads: ["closures"], cellular: [], power: ["outages"], social: [], facilities: [], landslides: ["landslides"],
};
const BASE_VIS: Vis = { roads: true };
const LAYERS: { group: string; items: [string, string][] }[] = [
  { group: "Hazard", items: [["flood", "Flood water"], ["rivers", "Rivers"], ["runoff", "Runoff"], ["weather", "Rain field"], ["atmosphere", "Clouds & pressure"], ["landslides", "Landslides"], ["alerts", "Official alerts"]] },
  { group: "Impact", items: [["closures", "Road closures"], ["outages", "Power outages"], ["shelterBuildings", "Shelter / evacuate"], ["towers", "Cell sites"], ["social", "Social posts"]] },
  { group: "Assets", items: [["buildings", "Hospitals"], ["schools", "Schools"], ["shelter", "Shelters"], ["qrt", "Responders"], ["food", "Food"], ["dams", "River gauges"], ["roads", "Road network"]] },
];
const SUGGESTIONS = ["How do the next 15 days look?", "What happens in the next 72 hours?", "Which hospitals could lose access this week?", "Where will power and cell service fail?"];
const HORIZONS: [number, string][] = [[24, "24 h"], [72, "72 h"], [168, "7 days"], [360, "15 days"]];

export function ForecastConsole() {
  const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches;
  // ---------------------------------------------------------------- scene + map data
  const [scene, setScene] = useState<SceneSnapshot | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [factors, setFactors] = useState<Factors | null>(null);
  const [atmosphere, setAtmosphere] = useState<AtmosphereSnapshot | null>(null);
  const [bldgLayer, setBldgLayer] = useState<BuildingLayer | null>(null);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  useEffect(() => {
    let dead = false;
    Promise.all([ops.scene(), ops.atmosphere().catch(() => null)])
      .then(([s, a]) => { if (!dead) { setScene(mergeBipadIntoScene(s)); if (a) setAtmosphere(a); } })
      .catch((e) => { if (!dead) setLoadErr((e as Error).message); });
    getFactors().then((f) => { if (!dead) setFactors(f); }).catch(() => { /* the dock shows the error on run */ });
    fetchBuildings().then((b) => { if (!dead) setBldgLayer(b); });
    fetchScorecard().then((s) => { if (!dead) setScorecard(s); });
    return () => { dead = true; };
  }, []);

  // ---------------------------------------------------------------- conversation + run state
  const [phase, setPhase] = useState<Phase>("idle");
  const [input, setInput] = useState("");
  const [question, setQuestion] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [hours, setHours] = useState(360);
  const [picked, setPicked] = useState<string[]>([]);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [win, setWin] = useState<Window | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [agentState, setAgentState] = useState<Record<string, AgentState>>({});
  const [results, setResults] = useState<Record<string, AgentResult>>({});
  const [fusion, setFusion] = useState<string[]>([]);
  const [combined, setCombined] = useState<Combined[] | null>(null);
  const [report, setReport] = useState<{ markdown: string; by: "stackai" | "rules"; error?: string } | null>(null);
  const [reportState, setReportState] = useState<"idle" | "writing" | "done">("idle");
  const [llmOn, setLlmOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [boardMin, setBoardMin] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [approved, setApproved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const t0 = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------- map state
  const [vis, setVis] = useState<Vis>(BASE_VIS);
  const [rainOn, setRainOn] = useState(true);
  const [ran, setRan] = useState(false);
  const [revealN, setRevealN] = useState(0);
  const [pockets, setPockets] = useState(false);
  const [assessRain, setAssessRain] = useState<number | null>(null);
  const [assessResult, setAssessResult] = useState<AssessmentResult | null>(null);
  const [series, setSeries] = useState<{ hourly: number[]; daily: { day: string; mm: number }[]; peak: number; max24: number } | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [activeAlert, setActiveAlert] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [layersOpen, setLayersOpen] = useState(false);
  const [radioOpen, setRadioOpen] = useState(false);
  const radio = useRadio();
  // Analyst action updates.
  const [promptMode, setPromptMode] = useState<"ask" | "update">("ask");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [followup, setFollowup] = useState<NextRec | null>(null);
  const [actionsView, setActionsView] = useState<ActionsView | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [locFocus, setLocFocus] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ i: number; field: "place" | "dest" } | null>(null);
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number; key: number } | null>(null);
  const [liveCov, setLiveCov] = useState<Record<string, Coverage>>({});
  // Base imagery. Google (sharper, native z20) when the key has the Map Tiles API; Esri otherwise. The choice is remembered.
  const [gAvail, setGAvail] = useState<{ available: boolean; reason: string | null } | null>(null);
  const [base, setBase] = useState<"google" | "esri">(() => { try { return localStorage.getItem("stormahead.base") === "esri" ? "esri" : "google"; } catch { return "google"; } });
  const [gCopy, setGCopy] = useState("");
  const viewTimer = useRef<number | undefined>(undefined);
  useEffect(() => { fetch("/api/tiles/google/status").then((r) => r.json()).then((s) => { setGAvail(s); if (!s.available) setBase("esri"); }).catch(() => { setGAvail({ available: false, reason: "API unreachable" }); setBase("esri"); }); }, []);
  useEffect(() => { try { localStorage.setItem("stormahead.base", base); } catch { /* private mode */ } }, [base]);
  const onView = (v: { zoom: number; n: number; s: number; e: number; w: number }) => {
    window.clearTimeout(viewTimer.current);
    viewTimer.current = window.setTimeout(() => {
      fetch(`/api/tiles/google/attribution?zoom=${v.zoom.toFixed(1)}&n=${v.n}&s=${v.s}&e=${v.e}&w=${v.w}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setGCopy(j.copyright ?? ""); }).catch(() => {});
    }, 500);
  };
  useEffect(() => { actionsApi.view().then(setActionsView).catch(() => { /* server without actions */ }); }, []);
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const [selected, setSelected] = useState<Entity | null>(null);
  const [done, setDone] = useState<Done>({});
  const [details, setDetails] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [street, setStreet] = useState(false);
  const [token, setToken] = useState(savedToken);
  const [hover, setHover] = useState<string | null>(null);
  const [flying, setFlying] = useState(false);
  const revealTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => { window.clearInterval(revealTimer.current); abort.current?.abort(); }, []);

  const closuresTotal = scene?.entities.filter((e) => e.kind === "closure").length ?? 0;
  const startReveal = () => {
    window.clearInterval(revealTimer.current);
    setRevealN(0); setPockets(false);
    let n = 0;
    revealTimer.current = window.setInterval(() => {
      n += 1; setRevealN(n);
      if (n >= closuresTotal) { window.clearInterval(revealTimer.current); window.setTimeout(() => setPockets(true), 450); }
    }, 170);
  };

  // Road closures follow the water level during playback: none while dry, more as it rises, fewer as it drains.
  // (Computed from the same rain reservoir as the flood depth; see waterLevel.)
  const stageFromLevel = (L: number) => (L < 0.2 ? 0 : L < 0.5 ? 1 : L < 0.85 ? 2 : 3);

  useEffect(() => {
    if (assessRain === null) return;
    let dead = false;
    // Full-depth assessment once; the map scales it continuously with the water level (see waterLevel below).
    ops.assessment(assessRain, 3).then((a) => { if (!dead) setAssessResult(a); }).catch(() => { /* keep last */ });
    return () => { dead = true; };
  }, [assessRain]);

  // Elapsed timer while agents work.
  useEffect(() => {
    if (phase !== "running") return;
    const t = window.setInterval(() => setElapsed(Date.now() - t0.current), 100);
    return () => window.clearInterval(t);
  }, [phase]);

  // Replay: the play head slows down through heavy rain so the event itself gets screen time.
  useEffect(() => {
    if (!playing || !win) return;
    let raf = 0, last = performance.now(), pos = cursor >= win.hours ? 0 : cursor;
    const maxR = Math.max(0.1, ...(series?.hourly ?? [0.1]));
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const v = (series?.hourly[Math.floor(pos)] ?? 0) / maxR;
      pos += (dt * win.hours) / 14 / (1 + 7 * v);
      if (pos >= win.hours) { setCursor(win.hours); setPlaying(false); return; }
      setCursor(Math.floor(pos));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, win, series]);

  // ---------------------------------------------------------------- action updates
  const refreshCoverage = async (list: Combined[] | null) => {
    if (!list?.length) return;
    try { setLiveCov(await actionsApi.coverage(list.map((c) => ({ id: c.id, lon: c.lon, lat: c.lat })))); } catch { /* keep last */ }
  };
  const logUpdate = async (text: string) => {
    setRunErr(null); setParsing(true); setProposal(null); setPicking(null);
    try { setProposal(await actionsApi.parse(text)); setInput(""); }
    catch (e) { setRunErr(`Couldn't read that update: ${(e as Error).message}`); }
    finally { setParsing(false); }
  };
  const confirmUpdate = async () => {
    if (!proposal || saving) return;
    setSaving(true);
    try {
      const r = await actionsApi.save(proposal);
      setActionsView({ items: r.items, locations: r.locations, next: r.next });
      setProposal(null); setPicking(null); setFollowup(r.followup);
      const at = r.saved.find((a) => a.place)?.place;
      if (at) { setFlyTo({ lon: at.lon, lat: at.lat, key: Date.now() }); setLocFocus(r.locations.find((l) => Math.hypot((l.lon - at.lon) * 98.6, (l.lat - at.lat) * 110.6) < 0.3)?.key ?? null); }
      refreshCoverage(combined);
    } catch (e) { setRunErr(`Couldn't save: ${(e as Error).message}`); }
    finally { setSaving(false); }
  };
  const undoAction = async (id: string) => {
    try { setActionsView(await actionsApi.remove(id)); refreshCoverage(combined); } catch (e) { setRunErr((e as Error).message); }
  };
  const onMapPick = (at: [number, number]) => {
    if (!picking || !proposal) return;
    setProposal((p) => {
      if (!p) return p;
      const src = p.actions[picking.i];
      const name = (picking.field === "place" ? src?.placeText : src?.destText) ?? "Picked location";
      const spot = { name, lon: at[0], lat: at[1], kind: "picked on map" };
      const same = (t: string | null) => !!t && t.toLowerCase() === name.toLowerCase();
      // Place every unresolved mention of the same name at the picked spot.
      const actions = p.actions.map((a) => ({ ...a, place: a.place ?? (same(a.placeText) ? spot : null), dest: a.dest ?? (same(a.destText) ? spot : null) }));
      const left = actions.some((a) => (a.placeText && !a.place) || (a.destText && !a.dest));
      return { ...p, actions, warnings: left ? p.warnings : [] };
    });
    setPicking(null);
  };

  // ---------------------------------------------------------------- run lifecycle
  const ask = async (q: string) => {
    const text = q.trim(); if (!text) return;
    if (promptMode === "update" || looksLikeUpdate(text)) { if (promptMode !== "update") setPromptMode("update"); return logUpdate(text); }
    if (phase === "running") return;
    setRunErr(null); setQuestion(text);
    try {
      const it = await getIntent(text);
      setIntent(it); setHours(it.hours); setPicked(it.suggested); setPhase("scoping");
    } catch (e) { setRunErr(`Could not reach the agents: ${(e as Error).message}`); }
  };

  const reset = () => {
    window.clearInterval(revealTimer.current);
    setOrder([]); setAgentState({}); setResults({}); setFusion([]); setCombined(null); setReport(null); setReportState("idle");
    setRan(false); setRevealN(0); setPockets(false); setAssessRain(null); setAssessResult(null); setSeries(null);
    setVis(BASE_VIS); setActiveAlert(null); setPlaying(false); setApproved(false); setSelected(null); setReportOpen(false); setBoardMin(false);
  };

  const onEvent = (e: ForecastEvent) => {
    const upd = (id: string, f: (s: AgentState) => AgentState) => setAgentState((m) => (m[id] ? { ...m, [id]: f(m[id]!) } : m));
    switch (e.type) {
      case "run":
        setWin(e.window); setOrder(e.agents); setLlmOn(e.llm.configured); setCursor(e.window.hours);
        setAgentState(Object.fromEntries(e.agents.map((id) => [id, { status: "queued", steps: [] } as AgentState])));
        break;
      case "agent": upd(e.id, (s) => ({ ...s, status: "running" })); break;
      case "step": upd(e.id, (s) => ({ ...s, steps: [...s.steps, { kind: e.kind, text: e.text }] })); break;
      case "agent_done": {
        const r = e.result;
        upd(e.id, (s) => ({ ...s, status: "done", result: r, ms: e.ms }));
        setResults((m) => ({ ...m, [e.id]: r }));
        setRan(true);
        setVis((v) => ({ ...v, ...Object.fromEntries((FACTOR_VIS[e.id] ?? []).map((k) => [k, true])) }));
        if (e.id === "roads" && r.risk !== "low") startReveal();
        if (e.id === "weather" && r.map) {
          const m = r.map as { hourly: number[]; daily: { day: string; mm: number }[]; peakAt: number; max24: number };
          setSeries({ hourly: m.hourly, daily: m.daily, peak: m.peakAt, max24: m.max24 });
          setAssessRain((cur) => cur ?? Math.max(1, Math.round((m.max24 / 25.4) * 10) / 10));
        }
        if (e.id === "terrain" && typeof r.map?.["rainIn"] === "number") setAssessRain(Math.max(0.5, r.map["rainIn"] as number));
        if (e.id === "satellite") setAssessRain((cur) => cur ?? OBSERVED_IN);
        break;
      }
      case "fusion_step": setFusion((f) => [...f, e.text]); break;
      case "fusion": setCombined(e.findings); setLiveCov(Object.fromEntries(e.findings.flatMap((c) => (c.coverage ? [[c.id, c.coverage]] : [])))); break;
      case "report_start": setReportState("writing"); setReportOpen(true); break;
      case "report": setReport({ markdown: e.markdown, by: e.by, error: e.error }); setReportState("done"); actionsApi.view().then(setActionsView).catch(() => {}); break;
      case "done":
        setPhase("done"); setElapsed(e.ms); setFitKey((k) => k + 1);
        window.setTimeout(() => { setBoardMin(true); setCursor(0); setPlaying(true); }, 900);
        break;
      case "error": setRunErr(e.message); break;
    }
  };

  const run = async () => {
    if (!picked.length) return;
    reset();
    setPhase("running"); setInput(""); t0.current = Date.now(); setElapsed(0);
    abort.current?.abort();
    const ctl = new AbortController(); abort.current = ctl;
    try {
      await streamForecast({ question, hours, factors: picked }, onEvent, ctl.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") { setRunErr((e as Error).message); setPhase("idle"); }
    }
  };
  const stop = () => { abort.current?.abort(); setPhase(Object.keys(results).length ? "done" : "idle"); };

  // ---------------------------------------------------------------- derived map props
  const startIdx = win?.startIdx ?? 0;
  const pins = useMemo<MapAlertPin[]>(() => {
    const name = new Map((factors?.agents ?? []).map((a) => [a.id, a.factor]));
    const showAt = (at: number | null) => phase !== "done" || at === null || at - startIdx <= cursor;
    const single = Object.values(results).flatMap((r) => r.alerts).map((a) => ({
      id: a.id, lon: a.lon, lat: a.lat, severity: a.severity, title: a.title, detail: a.detail, when: a.when, source: `${name.get(a.agent) ?? a.agent} agent`, visible: showAt(a.at),
    }));
    const comb = (combined ?? []).map((c) => ({
      id: c.id, lon: c.lon, lat: c.lat, severity: c.severity, title: c.title, detail: `${coverageText(liveCov[c.id] ?? c.coverage)} ${c.why.join(" · ")}`.trim(), when: c.when, source: "Coordinator · combined finding", priority: c.priority, visible: showAt(c.at),
    }));
    return [...single, ...comb];
  }, [results, combined, cursor, phase, startIdx, factors, liveCov]);
  const actionPins = useMemo(() => (actionsView?.locations ?? []).map((l) => ({ id: l.key, lon: l.lon, lat: l.lat, name: l.name, label: locationLabel(l), active: locFocus === l.key })), [actionsView, locFocus]);

  const stationPins = useMemo(() => (radioOpen || radio.current
    ? (radio.dir?.stations ?? []).filter((st) => st.inValley && st.lat !== null && st.lon !== null).map((st) => ({ id: st.id, lon: st.lon!, lat: st.lat!, name: st.name, playing: radio.current?.id === st.id && radio.state !== "error" }))
    : []), [radioOpen, radio.current, radio.dir, radio.state]);
  const toggleStation = (id: string) => {
    const st = radio.dir?.stations.find((x) => x.id === id); if (!st) return;
    if (radio.current?.id === id && radio.state !== "error") radio.stop(); else radio.play(st);
  };

  const rainLevel = (() => {
    if (!rainOn) return 0;
    if (phase === "running") {
      const w = agentState["weather"];
      if (w?.status === "running") return 0.55;
      if (w?.status === "done" && series) return Math.min(1, 0.25 + series.max24 / 200);
      return 0;
    }
    if (phase === "done" && series) {
      const max = Math.max(0.1, ...series.hourly), v = series.hourly[Math.min(cursor, series.hourly.length - 1)] ?? 0;
      return v <= 0.05 ? 0 : Math.min(1, 0.12 + Math.pow(v / max, 0.6) * 0.88);
    }
    return 0;
  })();

  // Water level through the window (ILLUSTRATIVE): a linear reservoir on the hourly valley rain. Water builds while it
  // rains and drains with a ~30 h time constant, normalised so the window's peak = the assessed depth.
  const reservoir = useMemo(() => {
    if (!series) return null;
    const k = Math.exp(-1 / 30); let st = 0;
    const out = series.hourly.map((r) => (st = st * k + r));
    const max = Math.max(1e-6, ...out);
    return out.map((v) => v / max);
  }, [series]);
  const gauge = results["rivers"]?.map as { station: string; stageM: (number | null)[]; level: (number | null)[]; dangerLevel: number; warningLevel: number } | undefined;
  const atHour = <T,>(a: T[] | undefined | null) => (a && a.length ? a[Math.max(0, Math.min(a.length - 1, cursor))] : undefined);
  const playback = phase === "done" && !!win;
  const waterLevel = playback && reservoir ? atHour(reservoir) ?? 1 : ran ? 1 : 0;
  // Rivers follow the real gauge where it has readings, and the rain model where it doesn't (null = no reading).
  const riverLevel = playback ? atHour(gauge?.level) ?? waterLevel : results["rivers"] ? 1 : waterLevel;
  const stage = playback && reservoir ? stageFromLevel(waterLevel) : 3;
  const stageNow = playback ? atHour(gauge?.stageM) ?? null : null;
  const readout = playback ? [
    reservoir ? `water ${Math.round(waterLevel * 100)}% of peak` : null,
    gauge && stageNow !== null && stageNow !== undefined ? `${gauge.station.replace(/ River at /, " at ")} ${stageNow.toFixed(1)} m${stageNow >= gauge.dangerLevel ? " · above danger" : stageNow >= gauge.warningLevel ? " · above warning" : ""}` : null,
  ].filter(Boolean).join(" · ") : "";

  const depths = assessResult?.depths ?? [];
  const floodFc = assessResult?.floodFc ?? { type: "FeatureCollection" as const, features: [] };
  const flowUrl = assessResult?.flow ? `data:image/png;base64,${assessResult.flow.imagePngBase64}` : null;
  const field = useMemo(() => assessResult?.flow ? {
    grid: assessResult.flow.grid, gx: Float32Array.from(assessResult.flow.field.gx), gy: Float32Array.from(assessResult.flow.field.gy), acc: Float32Array.from(assessResult.flow.field.acc),
  } : null, [assessResult]);

  const pocketPts = useMemo(() => (scene?.entities ?? []).filter((e) => e.kind === "pocket").flatMap((p) => (p.geom.type === "MultiLineString" ? p.geom.coordinates.flat() : [])), [scene]);
  const isCutOff = useMemo(() => (lon: number, lat: number) => pocketPts.some((c) => Math.hypot((c[0]! - lon) * 98.6, (c[1]! - lat) * 110.6) < 0.35), [pocketPts]);
  const assessed = useMemo(() => (bldgLayer && scene ? assess(bldgLayer.list, depths, scene.floodPolys, isCutOff) : []), [bldgLayer, depths, scene, isCutOff]);
  const bldgFc = useMemo(() => ({ type: "FeatureCollection" as const, features: assessed.filter((b) => b.role !== "none").map((b) => ({ type: "Feature" as const, properties: { id: `BL-${b.id}`, color: ROLE_COLOR[b.role], floors: b.f, role: b.role }, geometry: { type: "Polygon" as const, coordinates: [b.ring] } })) }), [assessed]);
  const bldgPts = useMemo(() => ({ type: "FeatureCollection" as const, features: assessed.filter((b) => b.role !== "none").map((b) => ({ type: "Feature" as const, properties: { id: `BL-${b.id}`, color: ROLE_COLOR[b.role], role: b.role }, geometry: { type: "Point" as const, coordinates: b.at } })) }), [assessed]);
  const buildingById = useMemo(() => new Map(assessed.filter((b) => b.role !== "none").map((b) => { const e = toEntity(b); return [e.id, e] as const; })), [assessed]);

  const advice = selected?.kind === "building" ? buildingAdvice(selected) : selected && scene ? scene.advice[selected.id] : undefined;
  const acts = advice?.actions ?? [], why = advice?.reasons ?? [];
  const recs = useMemo<Rec[]>(() => {
    if (!selected || !scene) return [];
    const byId = new Map(scene.entities.map((e) => [e.id, e]));
    const word: Record<string, string> = { qrt: "", food: "Food ", shelter: "Shelter ", grid: "Crew ", alert: "Alert ", air: "Airlift ", army: "Army " };
    return acts.flatMap((a) => {
      const t = a.targetId ? byId.get(a.targetId) ?? buildingById.get(a.targetId) : undefined;
      return t && t.id !== selected.id ? [{ id: a.id, kind: a.kind, at: t.at, label: `${word[a.kind] ?? ""}${t.id} · ${distKm(selected.at, t.at).toFixed(1)} km`, target: t.id }] : [];
    });
  }, [selected, scene, acts, buildingById]);
  const linkedIds = useMemo(() => recs.flatMap((r) => (r.target ? [r.target] : [])), [recs]);

  const select = (e: Entity | null) => { setFlying(false); setPhoto(false); setSelected(e); if (e) setActiveAlert(null); };
  const pickAlert = (id: string | null) => { setActiveAlert(id); if (id) setSelected(null); };
  const showBoardFull = (phase === "running" || (phase === "done" && order.length > 0)) && !boardMin;
  const panelPad = narrow ? { left: 20, right: 20, top: 80, bottom: 260 } : { left: showBoardFull ? 470 : 40, right: reportOpen ? 480 : 40, top: 90, bottom: 190 };
  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(null), 3200); };

  if (loadErr) return <div className="shell fx-boot"><p>Could not load the map: {loadErr}</p></div>;
  if (!scene) return <div className="shell fx-boot"><div className="fx-boot-mark"><Logo /><span>StormAhead</span></div><i className="fx-spin big" /></div>;

  const agentsMeta = factors?.agents ?? [];
  const ticks = Object.values(results).flatMap((r) => r.alerts).filter((a) => a.at !== null).map((a) => ({ h: a.at! - startIdx, severity: a.severity }));
  const showBoard = phase === "running" || (phase === "done" && order.length > 0);

  return (
    <div className="shell fx">
      <MapStage scene={scene} ran={ran} revealN={revealN} showPockets={pockets} stage={stage} vis={vis} focus={null} selected={selected} recs={recs} hover={hover}
        buildings={bldgFc} buildingPts={bldgPts} buildingById={buildingById} verify={null} swipe={null} onSelect={select} compact={narrow}
        view3d={mode === "3d"} flood={floodFc} flowUrl={flowUrl} field={field} rainIn={assessRain ?? OBSERVED_IN} flying={flying} onFlyEnd={() => setFlying(false)}
        atmosphere={atmosphere} padLeft={24} alerts={pins} activeAlert={activeAlert} onAlert={pickAlert} fitAlertsKey={fitKey} panelPad={panelPad} stations={stationPins} onStation={toggleStation}
        actionPins={actionPins} onActionPin={(key) => { setLocFocus(key); setActionsOpen(true); setRadioOpen(false); setLayersOpen(false); }}
        flyTo={flyTo} onMapClick={picking ? onMapPick : undefined} picking={!!picking}
        waterLevel={waterLevel} riverLevel={riverLevel}
        base={base === "google" && gAvail?.available ? "google" : "esri"} onView={base === "google" && gAvail?.available ? onView : undefined} />
      {base === "google" && gAvail?.available && (
        <div className="fx-gattrib" aria-label="Imagery attribution">
          <img src="https://maps.gstatic.com/mapfiles/api-3/images/google_white5_hdpi.png" alt="Google" width={66} height={26} />
          {gCopy && <span>{gCopy}</span>}
        </div>
      )}
      <RainOverlay intensity={rainLevel} />
      <div className="fx-vignette" aria-hidden="true" />

      {/* ---------------- top bar ---------------- */}
      <header className="fx-top">
        <div className="fx-brand fx-glass">
          <Logo />
          <span className="fx-word">StormAhead</span>
          <span className="fx-sep" />
          <span className="fx-place">Kathmandu Valley</span>
          <span className="fx-clock" title="Replay of the September 2024 floods. The scenario clock is fixed before the event."><i className="fx-live" /> Replay · {factors?.nowLabel ?? "Thu 26 Sep, 06:00"} 2024 NPT</span>
        </div>
        <div className="fx-tools fx-glass">
          <span className={`fx-llm ${factors?.llm.configured ? "on" : "off"}`} title={factors?.llm.configured ? "LLM reasoning via StackAI" : `StackAI not configured: missing ${factors?.llm.missing.join(", ")}`}>
            <i /> {factors?.llm.configured ? "StackAI" : "LLM offline"}
          </span>
          {radio.current && !radioOpen && (
            <span className={`fx-np-pill ${radio.state}`}>
              <button className="fx-np-open" onClick={() => setRadioOpen(true)} title="Open live radio"><Eq on={radio.state === "playing"} /><span>{radio.current.name}</span></button>
              <button className="fx-np-x" onClick={radio.stop} aria-label="Stop radio"><Icon name="x" size={13} /></button>
            </span>
          )}
          <button className={`fx-tool${actionsOpen ? " on" : ""}`} onClick={() => { setActionsOpen((o) => !o); setRadioOpen(false); setLayersOpen(false); }} aria-expanded={actionsOpen}><Icon name="check" size={16} /><span>Actions</span>{(actionsView?.items.length ?? 0) > 0 && <b className="fx-badge-n">{actionsView!.items.length}</b>}</button>
          <button className={`fx-tool${radioOpen ? " on" : ""}`} onClick={() => { setRadioOpen((o) => !o); setLayersOpen(false); setActionsOpen(false); }} aria-expanded={radioOpen}><Icon name="radio" size={16} /><span>Radio</span></button>
          <button className={`fx-tool${layersOpen ? " on" : ""}`} onClick={() => { setLayersOpen((o) => !o); setRadioOpen(false); setActionsOpen(false); }} aria-expanded={layersOpen}><Icon name="layers" size={16} /><span>Layers</span></button>
          <button className={`fx-tool${mode === "3d" ? " on" : ""}`} onClick={() => setMode((m) => (m === "2d" ? "3d" : "2d"))} aria-pressed={mode === "3d"}><Icon name="cube" size={16} /><span>3D</span></button>
          <button className="fx-tool" onClick={() => setDetails(true)}><Icon name="info" size={16} /><span>Sources</span></button>
          {phase === "done" && !reportOpen && <button className="fx-tool accent" onClick={() => setReportOpen(true)}><Icon name="doc" size={16} /><span>Report</span></button>}
        </div>
      </header>

      {layersOpen && (
        <div className="fx-layers fx-glass" role="dialog" aria-label="Map layers">
          <div className="fx-layers-grp">
            <div className="fx-eyebrow">Base imagery</div>
            <div className="fx-horizon" role="group" aria-label="Base imagery">
              <button aria-pressed={base === "google" && !!gAvail?.available} disabled={!gAvail?.available} onClick={() => setBase("google")} title={gAvail?.available ? "Google satellite, native zoom 20" : `Unavailable: ${gAvail?.reason ?? "checking"}`}>Google · sharper</button>
              <button aria-pressed={base === "esri" || !gAvail?.available} onClick={() => setBase("esri")} title="Esri World Imagery, cached on disk, works offline">Esri · offline</button>
            </div>
            {gAvail && !gAvail.available && <p className="fx-caveat">Google imagery unavailable: {gAvail.reason}. Enable the Map Tiles API on the key's project.</p>}
          </div>
          <div className="fx-layers-row">
            <span>Rain animation</span>
            <button className="fx-switch" role="switch" aria-checked={rainOn} onClick={() => setRainOn((v) => !v)}><i /></button>
          </div>
          {LAYERS.map((g) => (
            <div key={g.group} className="fx-layers-grp">
              <div className="fx-eyebrow">{g.group}</div>
              <div className="fx-chips">{g.items.map(([k, l]) => <button key={k} className="fx-chip" aria-pressed={!!vis[k]} onClick={() => { setVis((v) => ({ ...v, [k]: !v[k] })); if (!ran && ["closures", "flood", "runoff", "outages", "landslides", "alerts", "shelterBuildings"].includes(k)) setRan(true); if ((k === "flood" || k === "runoff") && assessRain === null) setAssessRain(OBSERVED_IN); }}>{l}</button>)}</div>
            </div>
          ))}
          <p className="fx-caveat">Layers fill in as agents finish. Facilities and alerts are real (BIPAD); statuses are modelled; depot stock is simulated.</p>
        </div>
      )}

      {radioOpen && <RadioPanel radio={radio} onClose={() => setRadioOpen(false)} />}
      {actionsOpen && (
        <ActionsPanel view={actionsView} focus={locFocus} onClose={() => setActionsOpen(false)} onUndo={undoAction}
          onFocus={(key, lon, lat) => { setLocFocus(key); setFlyTo({ lon, lat, key: Date.now() }); }}
          onNext={() => { const t = actionsView?.next.target; if (t) setFlyTo({ lon: t.lon, lat: t.lat, key: Date.now() }); }} />
      )}
      {picking && <div className="fx-pickbar fx-glass" role="status"><Icon name="found" size={14} /> Click the map where “{(picking.field === "place" ? proposal?.actions[picking.i]?.placeText : proposal?.actions[picking.i]?.destText) ?? "it"}” is <button className="fx-link" onClick={() => setPicking(null)}>Cancel</button></div>}

      {/* ---------------- agents + report ---------------- */}
      {showBoard && factors && (
        <AgentBoard agents={agentsMeta} order={order} state={agentState} fusion={fusion} combined={combined} reportState={reportState} reportBy={report?.by}
          elapsed={elapsed} minimized={boardMin} setMinimized={setBoardMin} onAlert={pickAlert} llmConfigured={llmOn} tallDock={phase === "done" && !!series} />
      )}
      {reportOpen && win && (
        <ReportPanel window={win} question={question} agents={agentsMeta} results={results} combined={(combined ?? []).map((c) => ({ ...c, coverage: liveCov[c.id] ?? c.coverage }))} report={report} daily={series?.daily ?? null}
          activeAlert={activeAlert} onAlert={pickAlert} onClose={() => setReportOpen(false)} approved={approved}
          onApprove={() => { setApproved(true); flash("Draft approved and logged on this screen. Nothing was sent."); }} />
      )}

      {/* ---------------- bottom: timeline + prompt ---------------- */}
      <div className={`fx-dock${phase === "idle" ? " idle" : ""}${(reportOpen || actionsOpen || radioOpen) && !narrow ? " with-report" : ""}`}>
        {phase === "done" && series && win && (
          <Timeline startIso={win.start} hours={win.hours} hourly={series.hourly} ticks={ticks} cursor={cursor} setCursor={setCursor} playing={playing} setPlaying={setPlaying} peak={series.peak} readout={readout} level={reservoir} />
        )}

        {phase === "scoping" && intent && factors && (
          <div className="fx-scope fx-glass" role="dialog" aria-label="Choose factors">
            <div className="fx-scope-head">
              <div>
                <div className="fx-eyebrow">Forecast window</div>
                <div className="fx-scope-title">“{question}”</div>
                <div className="fx-sub">I'll look at the next {hours < 48 ? `${hours} hours` : `${Math.round(hours / 24)} days`} from {factors.nowLabel}. Which factors should I include?</div>
              </div>
              <button className="fx-icon-btn" onClick={() => setPhase(order.length ? "done" : "idle")} aria-label="Cancel"><Icon name="x" size={16} /></button>
            </div>
            <div className="fx-horizon" role="group" aria-label="Horizon">
              {HORIZONS.map(([h, l]) => <button key={h} aria-pressed={hours === h} onClick={() => setHours(h)}>{l}</button>)}
              {!HORIZONS.some(([h]) => h === hours) && <button aria-pressed>{hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`}</button>}
            </div>
            <div className="fx-factor-grid">
              {factors.agents.map((a) => {
                const on = picked.includes(a.id);
                return (
                  <button key={a.id} className={`fx-factor${on ? " on" : ""}`} aria-pressed={on} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== a.id) : [...p, a.id]))}>
                    <span className="fx-factor-ico"><Icon name={a.id} size={18} /></span>
                    <span className="fx-factor-txt"><b>{a.factor}</b><span>{a.sources}</span></span>
                    <span className="fx-check">{on && <Icon name="check" size={12} />}</span>
                  </button>
                );
              })}
            </div>
            <div className="fx-scope-foot">
              <button className="fx-link" onClick={() => setPicked(picked.length === factors.agents.length ? [] : factors.agents.map((a) => a.id))}>{picked.length === factors.agents.length ? "Clear all" : "Select all"}</button>
              <span className="fx-sub">{factors.llm.configured ? "Each agent reasons with the LLM via StackAI." : "LLM offline: agents will summarise with rules."}</span>
              <button className="fx-btn primary big" disabled={!picked.length} onClick={run}><Icon name="sparkle" size={15} /> Deploy {picked.length} agent{picked.length === 1 ? "" : "s"}</button>
            </div>
          </div>
        )}

        {phase === "idle" && !proposal && !followup && (
          <div className="fx-hello">
            <h1>What do you need to know?</h1>
            <p>Ask about the coming hours or days. Specialist agents read rain, rivers, terrain, satellite, roads, power, cell and social data in parallel, then draft a plan for you to approve.</p>
          </div>
        )}

        {followup && !proposal && (
          <FollowUp rec={followup} onClose={() => setFollowup(null)}
            onShow={() => { if (followup.target) setFlyTo({ lon: followup.target.lon, lat: followup.target.lat, key: Date.now() }); }}
            onPrefill={() => { setPromptMode("update"); setInput(followup.prefill ?? ""); setFollowup(null); window.setTimeout(() => inputRef.current?.focus(), 30); }} />
        )}
        {proposal && (
          <UpdateConfirm p={proposal} busy={saving} picking={picking} onConfirm={confirmUpdate} onCancel={() => { setProposal(null); setPicking(null); }}
            onEdit={() => { setInput(proposal.text); setProposal(null); setPicking(null); window.setTimeout(() => inputRef.current?.focus(), 30); }}
            onPick={(i, field) => setPicking((cur) => (cur?.i === i && cur.field === field ? null : { i, field }))} />
        )}
        <form className={`fx-prompt fx-glass${phase === "running" && promptMode === "ask" ? " busy" : ""}${promptMode === "update" ? " update" : ""}`} onSubmit={(e) => { e.preventDefault(); if (proposal && !input.trim()) confirmUpdate(); else ask(input); }}>
          <div className="fx-mode" role="group" aria-label="What are you typing?">
            <button type="button" aria-pressed={promptMode === "ask"} onClick={() => setPromptMode("ask")} title="Ask a question"><Icon name="sparkle" size={14} /><span>Ask</span></button>
            <button type="button" aria-pressed={promptMode === "update"} onClick={() => setPromptMode("update")} title="Log what was done on the ground"><Icon name="check" size={14} /><span>Update</span></button>
          </div>
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} disabled={phase === "running" && promptMode === "ask"}
            placeholder={promptMode === "update" ? "What happened? e.g. Sent QRT-2 to Balkhu, 40 people moved to Kalimati open space" : phase === "running" ? "Agents are working… (switch to Update to log an action)" : phase === "done" ? "Ask a follow-up, or type what was done" : "Ask StormAhead… e.g. How do the next 15 days look?"}
            aria-label={promptMode === "update" ? "Log an action update" : "Ask StormAhead"}
            onKeyDown={(e) => { if (e.key === "Escape") { if (proposal) { setProposal(null); setPicking(null); } else if (phase === "scoping") setPhase(order.length ? "done" : "idle"); } }} />
          {phase === "running" && promptMode === "ask"
            ? <button type="button" className="fx-send stop" onClick={stop} aria-label="Stop agents"><i /></button>
            : <button type="submit" className="fx-send" disabled={(!input.trim() && !proposal) || parsing} aria-label={promptMode === "update" ? "Log update" : "Ask"}>{parsing ? <i className="fx-spin dark" /> : <Icon name={promptMode === "update" ? "check" : "send"} size={17} />}</button>}
        </form>
        {phase === "idle" && !proposal && !followup && (
          <div className="fx-suggest">{SUGGESTIONS.map((s) => <button key={s} onClick={() => { setInput(s); ask(s); }}>{s}</button>)}</div>
        )}
        {runErr && <p className="fx-err dock">{runErr}</p>}
      </div>

      {toast && <div className="fx-toast fx-glass" role="status"><Icon name="check" size={15} /> {toast}</div>}

      {photo && selected && <PhotorealView token={token} setToken={setToken} ran={ran} selected={selected} depths={depths} floodPolys={scene.floodPolys} entities={scene.entities} linked={linkedIds} onClose={() => setPhoto(false)} />}
      {street && selected && <StreetView selected={selected} onClose={() => setStreet(false)} />}
      <ContextDrawer key={selected?.id ?? "none"} onHover={setHover} onFly={() => { setMode("3d"); window.setTimeout(() => setFlying(true), mode === "3d" ? 50 : 1500); }}
        onPhoto={() => { setFlying(false); setStreet(false); setPhoto(true); }} onStreet={() => { setFlying(false); setPhoto(false); setStreet(true); }}
        e={selected} done={done} setDone={setDone} onClose={() => { setFlying(false); setPhoto(false); setStreet(false); setSelected(null); }}
        reasons={why} actions={acts} kindLabel={{ ...scene.kindLabel, building: "Building" }} feed={selected ? <SocialFeed at={selected.at} compact /> : null} />
      <DetailsDialog open={details} onClose={() => setDetails(false)} done={done} scorecard={scorecard} note={scene.note}
        agentLines={order.length ? order.map((id) => `${agentsMeta.find((a) => a.id === id)?.name ?? id}: ${results[id]?.headline ?? "not finished"} (${results[id]?.by === "stackai" ? "LLM via StackAI" : "rules"})`) : ["No forecast run yet. Ask a question to deploy the agents."]} />
    </div>
  );
}

function coverageText(c: Coverage | undefined): string {
  if (!c) return "";
  if (c.status === "none") return "No action logged here yet.";
  const who = c.resources.length ? c.resources.join(", ") : "Help";
  if (c.status === "partial") return `${who} on site; about ${c.remaining?.toLocaleString("en-US")} people may remain (estimate).`;
  return `${who} on site; looks covered.`;
}

function Logo() {
  return (
    <svg className="fx-logo" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <defs><linearGradient id="fxg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7DD3FC" /><stop offset="1" stopColor="#2DD4BF" /></linearGradient></defs>
      <path d="M12 2.5c3.6 0 6.5 2.4 6.5 5.4 0 2.2-1.6 3.6-3.6 3.6-1.6 0-2.6-.9-2.6-2.2 0-1 .7-1.6 1.5-1.6M12 21.5c-3.6 0-6.5-2.4-6.5-5.4 0-2.2 1.6-3.6 3.6-3.6 1.6 0 2.6.9 2.6 2.2 0 1-.7 1.6-1.5 1.6" fill="none" stroke="url(#fxg)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.6" fill="url(#fxg)" />
    </svg>
  );
}
