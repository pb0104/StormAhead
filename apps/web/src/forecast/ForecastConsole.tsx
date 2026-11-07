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
import { TalkToggle, useLiveTalk } from "./ForecastTalk.tsx";
import { getFactors, getIntent, streamForecast, type AgentResult, type Combined, type Factors, type ForecastEvent, type Intent, type Window } from "./api.ts";
import { affectedTowers, pickRainfallAlert, rainfallAlerts, resolvePlace, socialHotspots } from "../voice/insights.ts";
import { buildSnapshot, resolveEntity, type OpsHandle } from "../voice/opsHandle.ts";
import { resolveAgentIds } from "../voice/agentNames.ts";
import { voiceForAgent } from "../../../../packages/voice/agentVoices.ts";
import "./forecast.css";

type Phase = "idle" | "scoping" | "running" | "done";

/** Map layers each agent turns on when it finishes: impact only. Asset layers (sites, schools, cells…) stay in Layers. */
const FACTOR_VIS: Record<string, string[]> = {
  weather: [], rivers: [], terrain: ["flood", "runoff"], satellite: ["flood"],
  roads: ["closures"], cellular: [], power: ["outages"], social: [], facilities: [], landslides: ["landslides"],
};
const BASE_VIS: Vis = { roads: true };
const LAYERS: { group: string; items: [string, string][] }[] = [
  { group: "Hazard", items: [["flood", "Flood water"], ["runoff", "Runoff"], ["weather", "Rain field"], ["atmosphere", "Clouds & pressure"], ["landslides", "Landslides"], ["alerts", "Official alerts"]] },
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
  const [focusedAgent, setFocusedAgent] = useState<string | null>(null);
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

  // Stage follows the play head: before the peak the water is still rising.
  const stage = phase === "done" && series ? (cursor < series.peak - 18 ? 1 : cursor < series.peak ? 2 : 3) : 3;

  useEffect(() => {
    if (assessRain === null) return;
    let dead = false;
    ops.assessment(assessRain, stage).then((a) => { if (!dead) setAssessResult(a); }).catch(() => { /* keep last */ });
    return () => { dead = true; };
  }, [assessRain, stage]);

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

  // ---------------------------------------------------------------- run lifecycle
  const ask = async (q: string) => {
    const text = q.trim(); if (!text) return;
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
    setVis(BASE_VIS); setActiveAlert(null); setPlaying(false); setApproved(false); setSelected(null); setReportOpen(false); setBoardMin(false); setFocusedAgent(null);
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
      case "fusion": setCombined(e.findings); break;
      case "report_start": setReportState("writing"); setReportOpen(true); break;
      case "report": setReport({ markdown: e.markdown, by: e.by, error: e.error }); setReportState("done"); break;
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
      id: c.id, lon: c.lon, lat: c.lat, severity: c.severity, title: c.title, detail: c.why.join(" · "), when: c.when, source: "Coordinator · combined finding", priority: c.priority, visible: showAt(c.at),
    }));
    return [...single, ...comb];
  }, [results, combined, cursor, phase, startIdx, factors]);

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

  const askRef = useRef(ask);
  askRef.current = ask;
  const runRef = useRef(run);
  runRef.current = run;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const focusedAgentRef = useRef(focusedAgent);
  focusedAgentRef.current = focusedAgent;
  const agentStateRef = useRef(agentState);
  agentStateRef.current = agentState;
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const agentsMetaRef = useRef(factors?.agents ?? []);
  agentsMetaRef.current = factors?.agents ?? [];
  const talkOpenCtxRef = useRef<((t: string, opts?: { voice?: string; persona?: string }) => void) | null>(null);

  const briefingFor = (id: string) => {
    const meta = agentsMetaRef.current.find((a) => a.id === id);
    const r = resultsRef.current[id] ?? agentStateRef.current[id]?.result;
    if (!meta || !r) return null;
    return {
      id,
      name: meta.name,
      factor: meta.factor,
      sources: meta.sources,
      risk: r.risk,
      headline: r.headline,
      thinking: r.thinking,
      watch: r.watch,
      facts: r.facts,
      alerts: r.alerts.map((a) => ({ id: a.id, title: a.title, detail: a.detail, severity: a.severity, when: a.when })),
      by: r.by,
    };
  };

  const focusAgentChannel = (id: string) => {
    const brief = briefingFor(id);
    if (!brief) return { ok: false as const, error: "agent not finished yet" };
    setFocusedAgent(id);
    setBoardMin(false);
    const { voice, callSign } = voiceForAgent(id);
    const ctx = [
      `[OPERATOR SELECTED AGENT CHANNEL]`,
      `Your name is ${callSign}. You are the specialist "${brief.name}" (${brief.factor}).`,
      `Answer follow-up questions ONLY from this briefing. Cite numbers from it. Keep answers short and spoken.`,
      `Risk: ${brief.risk}`,
      `Headline: ${brief.headline}`,
      `Watch: ${brief.watch || "(none)"}`,
      `Reasoning:`,
      ...brief.thinking.map((t, i) => `${i + 1}. ${t}`),
      `Facts: ${JSON.stringify(brief.facts)}`,
      `Alerts: ${brief.alerts.map((a) => a.title).join("; ") || "(none)"}`,
      `Say your name (${callSign}) in one short sentence, then wait for questions.`,
    ].join("\n");
    talkOpenCtxRef.current?.(ctx, { voice, persona: callSign });
    return { ok: true as const, agent: brief.name, callSign, voice, id };
  };

  const talkHandle = useMemo<OpsHandle>(() => ({
    getState: () => buildSnapshot({ stage, rain: assessRain ?? OBSERVED_IN, ran, busy: phase === "running", focus: null, mode, selected, vis, done, scene }),
    getEntityContext: () => ({
      selected: selected ? { id: selected.id, name: selected.name, kind: selected.kind } : null,
      reasons: why.map((r) => ({ input: r.input, text: r.text })),
      actions: acts.map((a) => ({ id: a.id, kind: a.kind, title: a.title, detail: a.detail })),
    }),
    setStage: () => { /* forecast stage follows the timeline */ },
    setRain: (inches) => setAssessRain(inches),
    run: () => { void runRef.current(); },
    toggle: (key) => setVis((v) => ({ ...v, [key]: !v[key] })),
    pick: () => { /* status strip not in this console */ },
    selectByQuery: (q) => {
      const e = resolveEntity(scene, buildingById, q);
      if (!e) return { ok: false, error: q.name ? `No match for "${q.name}"` : `Unknown id ${q.id ?? ""}` };
      select(e);
      return { ok: true, id: e.id };
    },
    setMode: (m) => setMode(m),
    startFly: () => { if (!selected) return; setMode("3d"); window.setTimeout(() => setFlying(true), mode === "3d" ? 50 : 1500); },
    openPhoto: () => { if (selected) { setFlying(false); setStreet(false); setPhoto(true); } },
    applyDone: (actionId, modeStamp) => {
      if (!acts.some((a) => a.id === actionId)) return { ok: false, error: "actionId not on selected entity" };
      setDone((d) => ({ ...d, [actionId]: modeStamp }));
      return { ok: true, simulated: true as const };
    },
    undoDone: (actionId) => { setDone((d) => { const n = { ...d }; delete n[actionId]; return n; }); return { ok: true }; },
    setAlertPreview: () => {},
    ensureLayer: (key) => setVis((v) => (v[key] ? v : { ...v, [key]: true })),
    setInsight: () => {},
    flyBounds: () => setFitKey((k) => k + 1),
    showHighRainfall: (placeName) => {
      const info = rainfallAlerts(scene);
      const pickedAlert = pickRainfallAlert(scene, placeName);
      if (!pickedAlert) return { ok: false, error: "no Heavy Rainfall alerts", count: 0 };
      setVis((v) => ({ ...v, alerts: true }));
      setRan(true);
      select(pickedAlert);
      setFitKey((k) => k + 1);
      return { ok: true, count: info.count, selectedId: pickedAlert.id, selectedName: pickedAlert.name };
    },
    showAffectedTowers: () => {
      const t = affectedTowers(scene);
      setVis((v) => ({ ...v, towers: true }));
      setRan(true);
      if (t.entities[0]) select(t.entities[0]);
      setFitKey((k) => k + 1);
      return { ok: true, down: t.down, risk: t.risk, total: t.entities.length };
    },
    showSocialHotspots: (minPosts) => {
      const hot = socialHotspots(minPosts && minPosts >= 2 ? minPosts : 2);
      setVis((v) => ({ ...v, social: true }));
      setFitKey((k) => k + 1);
      return { ok: true, placeCount: hot.places.length, postCount: hot.ids.length, places: hot.places.slice(0, 8).map((p) => ({ name: p.name, count: p.count })) };
    },
    flyToPlace: (name) => {
      const place = resolvePlace(scene, name);
      if (!place.ok) return { ok: false, error: place.error, suggestions: place.suggestions };
      const e = resolveEntity(scene, buildingById, { name: place.name });
      if (e) select(e);
      setFitKey((k) => k + 1);
      return { ok: true, name: place.name, match: place.match };
    },
    clearInsights: () => {
      setVis(BASE_VIS);
      setSelected(null);
      setActiveAlert(null);
      setFitKey((k) => k + 1);
      return { ok: true };
    },
    askStormAhead: async (question) => {
      await askRef.current(question);
      return { ok: true, opened: "factor_picker", question };
    },
    deployAgents: () => {
      if (phaseRef.current === "running") return { ok: false, error: "agents already running" };
      if (phaseRef.current !== "scoping") return { ok: false, error: "call ask_stormahead first to open the factor picker" };
      if (!pickedRef.current.length) return { ok: false, error: "no factors selected" };
      void runRef.current();
      return { ok: true, deploying: pickedRef.current.length };
    },
    excludeAgents: (names) => {
      if (phaseRef.current !== "scoping") return { ok: false, error: "open the factor picker with ask_stormahead first" };
      const catalog = factors?.agents ?? [];
      const { ids, unknown } = resolveAgentIds(names, catalog);
      if (!ids.length) return { ok: false, error: "no matching agents", unknown, available: catalog.map((a) => a.id) };
      let next: string[] = [];
      setPicked((p) => {
        next = p.filter((id) => !ids.includes(id));
        pickedRef.current = next;
        return next;
      });
      return { ok: true, removed: ids, unknown, picked: next };
    },
    includeAgents: (names) => {
      if (phaseRef.current !== "scoping") return { ok: false, error: "open the factor picker with ask_stormahead first" };
      const catalog = factors?.agents ?? [];
      const { ids, unknown } = resolveAgentIds(names, catalog);
      if (!ids.length) return { ok: false, error: "no matching agents", unknown, available: catalog.map((a) => a.id) };
      let next: string[] = [];
      setPicked((p) => {
        next = [...new Set([...p, ...ids])];
        pickedRef.current = next;
        return next;
      });
      return { ok: true, added: ids, unknown, picked: next };
    },
    focusForecastAgent: (nameOrId) => {
      const catalog = agentsMetaRef.current;
      const { ids, unknown } = resolveAgentIds([nameOrId], catalog);
      const id = ids[0];
      if (!id) return { ok: false, error: "agent not found", unknown, available: catalog.map((a) => a.id) };
      return focusAgentChannel(id);
    },
    getFocusedAgentBriefing: () => {
      const id = focusedAgentRef.current;
      if (!id) return { ok: false, error: "no agent focused — click a finished agent card first" };
      const brief = briefingFor(id);
      if (!brief) return { ok: false, error: "focused agent has no briefing yet" };
      return { ok: true, ...brief };
    },
  }), [stage, assessRain, ran, phase, mode, selected, vis, done, scene, why, acts, buildingById, factors]);

  const talk = useLiveTalk(talkHandle);
  talkOpenCtxRef.current = talk.openWithContext;
  useEffect(() => {
    if (!talk.live) setFocusedAgent(null);
  }, [talk.live]);
  const talkSendRef = useRef(talk.send);
  talkSendRef.current = talk.send;
  const talkCanRef = useRef(talk.canSend);
  talkCanRef.current = talk.canSend;

  // Live + Wispr: submit when push-to-talk releases (Fn), not on a typing debounce.
  useEffect(() => {
    if (!talk.live) return;
    const el = inputRef.current;
    if (!el) return;
    let last = el.value;
    let waitInsertUntil = 0;
    let flushTimer = 0;

    const flush = () => {
      window.clearTimeout(flushTimer);
      if (!talkCanRef.current) return;
      const raw = (inputRef.current?.value ?? "").trim();
      if (!raw) return;
      if (talkSendRef.current(raw)) {
        setInput("");
        if (inputRef.current) inputRef.current.value = "";
        last = "";
        waitInsertUntil = 0;
      }
    };

    const syncFromDom = () => {
      const v = el.value;
      if (v === last) return;
      const wasEmpty = !String(last).trim();
      last = v;
      setInput(v);
      // Text arrived right after Fn release / paste → send.
      if (v.trim() && performance.now() < waitInsertUntil) {
        flush();
        return;
      }
      // Fn often never reaches the page; Wispr dumps the whole phrase at once.
      if (wasEmpty && v.trim().length >= 2) {
        waitInsertUntil = performance.now() + 400;
        window.clearTimeout(flushTimer);
        flushTimer = window.setTimeout(flush, 100);
      }
    };

    const isPttRelease = (e: KeyboardEvent) =>
      // Wispr default on Mac is Fn / Globe.
      e.key === "Fn" || e.code === "Fn" || e.key === "Process";

    const onKeyUp = (e: KeyboardEvent) => {
      if (!isPttRelease(e)) return;
      // Wispr inserts the transcript after release — watch briefly, then flush.
      waitInsertUntil = performance.now() + 900;
      window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(flush, 180);
      window.setTimeout(flush, 450);
    };

    const onPaste = () => {
      waitInsertUntil = performance.now() + 500;
      requestAnimationFrame(() => {
        syncFromDom();
        flush();
      });
    };

    window.addEventListener("keyup", onKeyUp, true);
    el.addEventListener("input", syncFromDom);
    el.addEventListener("change", syncFromDom);
    el.addEventListener("paste", onPaste);
    const poll = window.setInterval(syncFromDom, 80);
    return () => {
      window.removeEventListener("keyup", onKeyUp, true);
      el.removeEventListener("input", syncFromDom);
      el.removeEventListener("change", syncFromDom);
      el.removeEventListener("paste", onPaste);
      window.clearInterval(poll);
      window.clearTimeout(flushTimer);
    };
  }, [talk.live]);

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
        atmosphere={atmosphere} padLeft={24} alerts={pins} activeAlert={activeAlert} onAlert={pickAlert} fitAlertsKey={fitKey} panelPad={panelPad} stations={stationPins} onStation={toggleStation} />
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
          <TalkToggle talk={talk} />
          <button className={`fx-tool${radioOpen ? " on" : ""}`} onClick={() => { setRadioOpen((o) => !o); setLayersOpen(false); }} aria-expanded={radioOpen}><Icon name="radio" size={16} /><span>Radio</span></button>
          <button className={`fx-tool${layersOpen ? " on" : ""}`} onClick={() => { setLayersOpen((o) => !o); setRadioOpen(false); }} aria-expanded={layersOpen}><Icon name="layers" size={16} /><span>Layers</span></button>
          <button className={`fx-tool${mode === "3d" ? " on" : ""}`} onClick={() => setMode((m) => (m === "2d" ? "3d" : "2d"))} aria-pressed={mode === "3d"}><Icon name="cube" size={16} /><span>3D</span></button>
          <button className="fx-tool" onClick={() => setDetails(true)}><Icon name="info" size={16} /><span>Sources</span></button>
          {phase === "done" && !reportOpen && <button className="fx-tool accent" onClick={() => setReportOpen(true)}><Icon name="doc" size={16} /><span>Report</span></button>}
        </div>
      </header>

      {layersOpen && (
        <div className="fx-layers fx-glass" role="dialog" aria-label="Map layers">
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

      {/* ---------------- agents + report ---------------- */}
      {showBoard && factors && (
        <AgentBoard agents={agentsMeta} order={order} state={agentState} fusion={fusion} combined={combined} reportState={reportState} reportBy={report?.by}
          elapsed={elapsed} minimized={boardMin} setMinimized={setBoardMin} onAlert={pickAlert} llmConfigured={llmOn} tallDock={phase === "done" && !!series}
          focusedId={focusedAgent} onFocusAgent={(id) => { focusAgentChannel(id); }} />
      )}
      {reportOpen && win && (
        <ReportPanel window={win} question={question} agents={agentsMeta} results={results} combined={combined ?? []} report={report} daily={series?.daily ?? null}
          activeAlert={activeAlert} onAlert={pickAlert} onClose={() => setReportOpen(false)} approved={approved}
          onApprove={() => { setApproved(true); flash("Draft approved and logged on this screen. Nothing was sent."); }} />
      )}

      {/* ---------------- bottom: timeline + prompt ---------------- */}
      <div className={`fx-dock${phase === "idle" ? " idle" : ""}${reportOpen && !narrow ? " with-report" : ""}`}>
        {phase === "done" && series && win && (
          <Timeline startIso={win.start} hours={win.hours} hourly={series.hourly} ticks={ticks} cursor={cursor} setCursor={setCursor} playing={playing} setPlaying={setPlaying} peak={series.peak} />
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

        {phase === "idle" && (
          <div className="fx-hello">
            <h1>What do you need to know?</h1>
            <p>Ask about the coming hours or days. Specialist agents read rain, rivers, terrain, satellite, roads, power, cell and social data in parallel, then draft a plan for you to approve.</p>
          </div>
        )}

        <form
          className={`fx-prompt fx-glass${phase === "running" ? " busy" : ""}${talk.live ? " talk" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (talk.canSend) {
              if (talk.send(input)) setInput("");
              return;
            }
            ask(input);
          }}
        >
          <Icon name="sparkle" size={18} className="fx-prompt-ico" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={phase === "running" && !talk.canSend}
            placeholder={
              talk.status === "connecting" ? "Connecting spoken assistant…"
                : talk.canSend
                  ? (focusedAgent
                    ? `Ask ${agentsMeta.find((a) => a.id === focusedAgent)?.name ?? "agent"}…`
                    : "Talk: type or paste from Wispr Flow…")
                  : phase === "running" ? "Agents are working…"
                    : phase === "done" ? "Ask a follow-up or a new question…"
                      : "Ask StormAhead… e.g. How do the next 15 days look?"
            }
            aria-label={talk.live ? "Talk to StormAhead" : "Ask StormAhead"}
            onKeyDown={(e) => { if (e.key === "Escape" && phase === "scoping") setPhase(order.length ? "done" : "idle"); }}
          />
          {phase === "running" && !talk.canSend
            ? <button type="button" className="fx-send stop" onClick={stop} aria-label="Stop agents"><i /></button>
            : <button type="submit" className="fx-send" disabled={!input.trim() || (talk.live && !talk.canSend)} aria-label={talk.canSend ? "Send talk" : "Ask"}><Icon name="send" size={17} /></button>}
        </form>
        {talk.live && talk.log.length > 0 && (
          <div className="fx-talk-captions fx-glass" aria-live="polite">
            {talk.log.slice(-3).map((l, i) => (
              <p key={i} className={l.role === "user" ? "you" : "bot"}><b>{l.role === "user" ? "You" : (talk.persona ?? "ORACLE")}</b> {l.text}</p>
            ))}
          </div>
        )}
        {talk.error && <p className="fx-err dock">{talk.error}</p>}
        {phase === "idle" && !talk.live && (
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

function Logo() {
  return (
    <svg className="fx-logo" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <defs><linearGradient id="fxg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7DD3FC" /><stop offset="1" stopColor="#2DD4BF" /></linearGradient></defs>
      <path d="M12 2.5c3.6 0 6.5 2.4 6.5 5.4 0 2.2-1.6 3.6-3.6 3.6-1.6 0-2.6-.9-2.6-2.2 0-1 .7-1.6 1.5-1.6M12 21.5c-3.6 0-6.5-2.4-6.5-5.4 0-2.2 1.6-3.6 3.6-3.6 1.6 0 2.6.9 2.6 2.2 0 1-.7 1.6-1.5 1.6" fill="none" stroke="url(#fxg)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.6" fill="url(#fxg)" />
    </svg>
  );
}
