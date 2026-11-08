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
    getRoadClosures: (q, n) => ref.current.getRoadClosures(q, n),
    openStreetView: (q) => ref.current.openStreetView(q),
    closeStreetView: () => ref.current.closeStreetView(),
    clearInsights: () => ref.current.clearInsights(),
    askStormAhead: (q) => ref.current.askStormAhead(q),
    deployAgents: () => ref.current.deployAgents(),
    excludeAgents: (n) => ref.current.excludeAgents(n),
    includeAgents: (n) => ref.current.includeAgents(n),
    getOracleContext: () => ref.current.getOracleContext(),
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
  const handleRef = useRef(handle);
  handleRef.current = handle;

  useEffect(() => {
    session.current = createLiveSession(proxyHandle(handleRef), {
      onStatus: (s) => setStatus(s),
      onCaption: (t, role) => setLog((L) => [...L.slice(-30), { role, text: t }]),
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

  useEffect(() => {
    if (status !== "ready") return;
    const ctx = pendingContext.current;
    if (!ctx) return;
    pendingContext.current = null;
    session.current?.sendContext(ctx);
  }, [status]);

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

  return { status, error, log, live, canSend, toggle, send, openWithContext };
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
