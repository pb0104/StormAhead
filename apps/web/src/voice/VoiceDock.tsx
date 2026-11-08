import { useEffect, useRef, useState } from "react";
import { createLiveSession, type LiveStatus } from "./liveConnection.ts";
import type { OpsHandle } from "./opsHandle.ts";

const LABEL: Record<LiveStatus, string> = {
  idle: "OFF",
  connecting: "CONNECTING",
  ready: "READY",
  busy: "BUSY",
  error: "ERROR",
};

/** Idle ms after last change before auto-Send (Wispr dump / paste). */
const AUTO_SEND_MS = 350;

export function VoiceDock({ handle }: { handle: OpsHandle }) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<{ role: "assistant" | "user"; text: string }[]>([]);
  const session = useRef<ReturnType<typeof createLiveSession> | null>(null);
  const handleRef = useRef(handle);
  handleRef.current = handle;
  const inputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const pendingRef = useRef(0);
  const lastSeenRef = useRef("");

  useEffect(() => {
    const proxy: OpsHandle = {
      getState: () => handleRef.current.getState(),
      getEntityContext: () => handleRef.current.getEntityContext(),
      setStage: (n) => handleRef.current.setStage(n),
      setRain: (n) => handleRef.current.setRain(n),
      run: () => handleRef.current.run(),
      toggle: (k) => handleRef.current.toggle(k),
      pick: (k) => handleRef.current.pick(k),
      selectByQuery: (q) => handleRef.current.selectByQuery(q),
      setMode: (m) => handleRef.current.setMode(m),
      startFly: () => handleRef.current.startFly(),
      openPhoto: () => handleRef.current.openPhoto(),
      applyDone: (id, mode) => handleRef.current.applyDone(id, mode),
      undoDone: (id) => handleRef.current.undoDone(id),
      setAlertPreview: (id) => handleRef.current.setAlertPreview(id),
      ensureLayer: (k) => handleRef.current.ensureLayer(k),
      setInsight: (p) => handleRef.current.setInsight(p),
      flyBounds: (b, z) => handleRef.current.flyBounds(b, z),
      showHighRainfall: (n) => handleRef.current.showHighRainfall(n),
      showAffectedTowers: () => handleRef.current.showAffectedTowers(),
      showSocialHotspots: (n) => handleRef.current.showSocialHotspots(n),
      flyToPlace: (n) => handleRef.current.flyToPlace(n),
      searchSocialPosts: (o) => handleRef.current.searchSocialPosts(o),
    openSocialPost: (id) => handleRef.current.openSocialPost(id),
    getRoadClosures: (q, n) => handleRef.current.getRoadClosures(q, n),
    openStreetView: (q) => handleRef.current.openStreetView(q),
    closeStreetView: () => handleRef.current.closeStreetView(),
    clearInsights: () => handleRef.current.clearInsights(),
      askStormAhead: (q) => handleRef.current.askStormAhead(q),
      deployAgents: () => handleRef.current.deployAgents(),
      excludeAgents: (n) => handleRef.current.excludeAgents(n),
      includeAgents: (n) => handleRef.current.includeAgents(n),
      getOracleContext: () => handleRef.current.getOracleContext(),
      listActions: () => handleRef.current.listActions(),
      logAction: (t) => handleRef.current.logAction(t),
      confirmActionUpdate: () => handleRef.current.confirmActionUpdate(),
      cancelActionUpdate: () => handleRef.current.cancelActionUpdate(),
      editAction: (id, c) => handleRef.current.editAction(id, c),
      removeAction: (id) => handleRef.current.removeAction(id),
    };
    session.current = createLiveSession(proxy, {
      onStatus: (s, d) => {
        setStatus(s);
        setDetail(d ?? "");
      },
      onCaption: (t, role) => setLog((L) => [...L.slice(-40), { role, text: t }]),
      onError: (m) => setError(m),
    });
    return () => session.current?.stop();
  }, []);

  const flushSend = () => {
    const el = inputRef.current;
    const raw = (el?.value ?? "").trim();
    const st = statusRef.current;
    if (!raw || (st !== "ready" && st !== "busy")) return false;
    setError(null);
    session.current?.sendText(raw);
    if (el) el.value = "";
    lastSeenRef.current = "";
    return true;
  };

  const armAutoSend = () => {
    window.clearTimeout(pendingRef.current);
    pendingRef.current = window.setTimeout(() => {
      flushSend();
    }, AUTO_SEND_MS);
  };

  // Uncontrolled input + poll: Wispr often sets .value without React onChange.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const sync = () => {
      const v = el.value;
      if (v === lastSeenRef.current) return;
      lastSeenRef.current = v;
      if (v.trim()) armAutoSend();
    };
    el.addEventListener("input", sync);
    el.addEventListener("change", sync);
    el.addEventListener("paste", () => requestAnimationFrame(sync));
    const poll = window.setInterval(sync, 120);
    return () => {
      el.removeEventListener("input", sync);
      el.removeEventListener("change", sync);
      window.clearInterval(poll);
      window.clearTimeout(pendingRef.current);
    };
  }, []);

  // Text waiting while CONNECTING → send when READY.
  useEffect(() => {
    if (status !== "ready" && status !== "busy") return;
    if (!(inputRef.current?.value ?? "").trim()) return;
    armAutoSend();
  }, [status]);

  const on = status !== "idle" && status !== "error";
  const canSend = status === "ready" || status === "busy";

  return (
    <div className="voice-dock" aria-label="Ops assistant">
      <button
        type="button"
        className={`voice-toggle ${on ? "on" : ""}`}
        aria-pressed={on}
        onClick={() => {
          setError(null);
          if (on) session.current?.stop();
          else session.current?.connect();
        }}
      >
        {LABEL[status]}
      </button>
      <button
        type="button"
        className="voice-reset"
        onClick={() => {
          handle.clearInsights();
          setLog([]);
          setError(null);
        }}
      >
        Reset map
      </button>
      <form
        className="voice-form"
        onSubmit={(e) => {
          e.preventDefault();
          window.clearTimeout(pendingRef.current);
          flushSend();
        }}
      >
        <input
          ref={inputRef}
          className="voice-input"
          defaultValue=""
          onInput={armAutoSend}
          placeholder="Type or paste from Wispr Flow…"
          aria-label="Assistant text input"
          autoComplete="off"
        />
        <button type="submit" className="voice-send" disabled={!canSend}>
          Send
        </button>
      </form>
      {detail && status !== "ready" && <span className="voice-detail">{detail}</span>}
      {error && <span className="voice-err" role="alert">{error}</span>}
      {log.length > 0 && (
        <div className="voice-log" aria-live="polite">
          {log.slice(-6).map((l, i) => (
            <p key={i} className={l.role === "user" ? "you" : "bot"}>
              <b>{l.role === "user" ? "YOU" : "ORACLE"}</b> {l.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
