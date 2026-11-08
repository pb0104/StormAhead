/**
 * Gemini Live talk for the forecast console — single ORACLE channel.
 * Top-bar toggle; the main Ask bar sends when Live is on.
 */
import { useEffect, useRef, useState } from "react";
import { createLiveSession, type LiveStatus } from "../voice/liveConnection.ts";
import type { OpsHandle } from "../voice/opsHandle.ts";
import { Icon } from "./Icon.tsx";

const LABEL: Record<LiveStatus, string> = {
  idle: "Talk",
  connecting: "…",
  ready: "Live",
  busy: "Speak",
  error: "Retry",
};

export type LiveTalk = {
  status: LiveStatus;
  error: string | null;
  log: { role: "assistant" | "user"; text: string }[];
  live: boolean;
  canSend: boolean;
  toggle: () => void;
  send: (text: string) => boolean;
  /** Send to ORACLE, reconnecting first if the session is off or dropped. */
  sendOrConnect: (text: string) => void;
  /** Push quiet context once Live is ready (assessment / UI briefing). */
  openWithContext: (text: string) => void;
};

function proxyHandle(ref: { current: OpsHandle }): OpsHandle {
  return {
    getState: () => ref.current.getState(),
    getEntityContext: () => ref.current.getEntityContext(),
    setStage: (n) => ref.current.setStage(n),
    setRain: (n) => ref.current.setRain(n),
    run: () => ref.current.run(),
    toggle: (k) => ref.current.toggle(k),
    pick: (k) => ref.current.pick(k),
    selectByQuery: (q) => ref.current.selectByQuery(q),
    setMode: (m) => ref.current.setMode(m),
    startFly: () => ref.current.startFly(),
    openPhoto: () => ref.current.openPhoto(),
    applyDone: (id, mode) => ref.current.applyDone(id, mode),
    undoDone: (id) => ref.current.undoDone(id),
    setAlertPreview: (id) => ref.current.setAlertPreview(id),
    ensureLayer: (k) => ref.current.ensureLayer(k),
    setInsight: (p) => ref.current.setInsight(p),
    flyBounds: (b, z) => ref.current.flyBounds(b, z),
    showHighRainfall: (n) => ref.current.showHighRainfall(n),
    showAffectedTowers: () => ref.current.showAffectedTowers(),
    showSocialHotspots: (n) => ref.current.showSocialHotspots(n),
    flyToPlace: (n) => ref.current.flyToPlace(n),
    searchSocialPosts: (o) => ref.current.searchSocialPosts(o),
    openSocialPost: (id) => ref.current.openSocialPost(id),
    listRadioStations: (o) => ref.current.listRadioStations(o),
    tuneRadio: (q) => ref.current.tuneRadio(q),
    stopRadio: (c) => ref.current.stopRadio(c),
    getRoadClosures: (q, n) => ref.current.getRoadClosures(q, n),
    showAlternativeRoutes: (q) => ref.current.showAlternativeRoutes(q),
    clearRoutes: () => ref.current.clearRoutes(),
    closeReplay: () => ref.current.closeReplay(),
    openReplay: () => ref.current.openReplay(),
    getReliefNeeds: (q) => ref.current.getReliefNeeds(q),
    openAllocation: (a) => ref.current.openAllocation(a),
    openStreetView: (q) => ref.current.openStreetView(q),
    closeStreetView: () => ref.current.closeStreetView(),
    clearInsights: () => ref.current.clearInsights(),
    askStormAhead: (q) => ref.current.askStormAhead(q),
    deployAgents: () => ref.current.deployAgents(),
    excludeAgents: (n) => ref.current.excludeAgents(n),
    includeAgents: (n) => ref.current.includeAgents(n),
    getOracleContext: () => ref.current.getOracleContext(),
    getEvaluation: () => ref.current.getEvaluation(),
    listActions: () => ref.current.listActions(),
    logAction: (t) => ref.current.logAction(t),
    confirmActionUpdate: () => ref.current.confirmActionUpdate(),
    cancelActionUpdate: () => ref.current.cancelActionUpdate(),
    editAction: (id, c) => ref.current.editAction(id, c),
    removeAction: (id) => ref.current.removeAction(id),
  };
}

export function useLiveTalk(handle: OpsHandle): LiveTalk {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<{ role: "assistant" | "user"; text: string }[]>([]);
  const session = useRef<ReturnType<typeof createLiveSession> | null>(null);
  const botOpen = useRef(false);
  const handleRef = useRef(handle);
  handleRef.current = handle;

  useEffect(() => {
    session.current = createLiveSession(proxyHandle(handleRef), {
      onStatus: (s) => setStatus(s),
      // Live sends a reply as many small transcript pieces: join them into one message per turn.
      onCaption: (t, role) => setLog((L) => {
        const last = L[L.length - 1];
        if (role === "assistant" && last?.role === "assistant" && botOpen.current) {
          const sep = /\s$/.test(last.text) || /^[\s.,!?;:'’)]/.test(t) ? "" : " ";
          return [...L.slice(0, -1), { role, text: last.text + sep + t }];
        }
        if (role === "assistant") botOpen.current = true;
        else botOpen.current = false;
        return [...L.slice(-199), { role, text: t.trim() }];
      }),
      onTurnEnd: () => { botOpen.current = false; },
      onError: (m) => setError(m),
    });
    return () => session.current?.stop();
  }, []);

  const statusRef = useRef(status);
  statusRef.current = status;

  const live = status !== "idle" && status !== "error";
  const canSend = status === "ready" || status === "busy";

  const send = (text: string) => {
    const t = text.trim();
    const st = statusRef.current;
    if (!t || (st !== "ready" && st !== "busy")) return false;
    setError(null);
    session.current?.sendText(t);
    return true;
  };

  const pendingContext = useRef<string | null>(null);
  const pendingText = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "ready") return;
    const ctx = pendingContext.current;
    if (ctx) { pendingContext.current = null; session.current?.sendContext(ctx); }
    const txt = pendingText.current;
    if (txt) { pendingText.current = null; session.current?.sendText(txt); }
  }, [status]);

  /** Send a user message to ORACLE, connecting first (and sending once READY) if the session is off or dropped. */
  const sendOrConnect = (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (send(t)) return;
    setError(null);
    pendingText.current = t;
    const st = statusRef.current;
    if (st === "idle" || st === "error") session.current?.connect();
  };

  const openWithContext = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setError(null);
    const st = statusRef.current;
    if (st === "ready" || st === "busy") {
      session.current?.sendContext(t);
      return;
    }
    pendingContext.current = t;
    if (st === "idle" || st === "error") session.current?.connect();
  };

  const toggle = () => {
    setError(null);
    if (live) session.current?.stop();
    else session.current?.connect();
  };

  return { status, error, log, live, canSend, toggle, send, sendOrConnect, openWithContext };
}

export function TalkToggle({ talk }: { talk: LiveTalk }) {
  return (
    <button
      type="button"
      className={`fx-tool${talk.live ? " on" : ""}`}
      aria-pressed={talk.live}
      onClick={talk.toggle}
      title="Talk to ORACLE — uses the Ask bar below"
    >
      <Icon name="sparkle" size={16} />
      <span>{LABEL[talk.status]}</span>
    </button>
  );
}
