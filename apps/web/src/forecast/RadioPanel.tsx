/**
 * Live broadcast radio (Radio Browser directory). One <audio> element connects the browser straight to the broadcaster;
 * nothing is proxied, recorded or transcribed. Live today — not part of the 2024 replay.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon.tsx";

export type Station = {
  id: string; name: string; url: string; homepage: string | null; codec: string; bitrate: number; tags: string[]; language: string;
  state: string; lat: number | null; lon: number | null; distKm: number | null; inValley: boolean; news: boolean; local: boolean; clicks: number;
};
type Directory = { source: string; licence: string; note: string; retrievedAt: string; stale: boolean; stations: Station[] };
export type RadioState = "idle" | "loading" | "playing" | "error";

/** Owns the audio element so playback survives closing the panel. */
export function useRadio() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [dir, setDir] = useState<Directory | null>(null);
  const [dirErr, setDirErr] = useState<string | null>(null);
  const [current, setCurrent] = useState<Station | null>(null);
  const [state, setState] = useState<RadioState>("idle");
  const [volume, setVolume] = useState(0.8);

  const load = useCallback(async () => {
    if (dir) return;
    try {
      const r = await fetch("/api/radio/stations");
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setDir(body as Directory); setDirErr(null);
    } catch (e) { setDirErr((e as Error).message); }
  }, [dir]);

  useEffect(() => {
    const a = new Audio();
    a.preload = "none";
    const on = (ev: string, f: () => void) => a.addEventListener(ev, f);
    on("playing", () => setState("playing"));
    on("waiting", () => setState((s) => (s === "idle" ? s : "loading")));
    on("error", () => { if (a.getAttribute("src")) setState("error"); });
    audio.current = a;
    return () => { a.pause(); a.removeAttribute("src"); a.load(); audio.current = null; };
  }, []);
  useEffect(() => { if (audio.current) audio.current.volume = volume; }, [volume]);

  const play = useCallback(async (s: Station) => {
    const a = audio.current; if (!a) return;
    setCurrent(s); setState("loading");
    a.src = s.url;
    try {
      await a.play();
      fetch(`/api/radio/click/${s.id}`, { method: "POST" }).catch(() => {});
    } catch (e) {
      if ((e as Error).name !== "AbortError") setState("error");
    }
  }, []);
  const stop = useCallback(() => {
    const a = audio.current; if (!a) return;
    a.pause(); a.removeAttribute("src"); a.load();
    setState("idle"); setCurrent(null);
  }, []);

  return { dir, dirErr, load, current, state, play, stop, volume, setVolume };
}
export type Radio = ReturnType<typeof useRadio>;

/** Animated bars while audio plays (CSS only: cross-origin streams can't be analysed without CORS). */
export function Eq({ on }: { on: boolean }) {
  return <span className={`fx-eq${on ? " on" : ""}`} aria-hidden="true"><i /><i /><i /><i /></span>;
}

const GROUPS: { key: "news" | "local" | "all"; label: string }[] = [
  { key: "news", label: "News" }, { key: "local", label: "Kathmandu" }, { key: "all", label: "All Nepal" },
];

export function RadioPanel({ radio, onClose }: { radio: Radio; onClose: () => void }) {
  const [group, setGroup] = useState<"news" | "local" | "all">("news");
  const [q, setQ] = useState("");
  const { dir, dirErr, load, current, state } = radio;
  useEffect(() => { load(); }, [load]);
  const list = useMemo(() => {
    const all = dir?.stations ?? [];
    const g = group === "news" ? all.filter((s) => s.news) : group === "local" ? all.filter((s) => s.local) : all;
    const t = q.trim().toLowerCase();
    return t ? g.filter((s) => `${s.name} ${s.tags.join(" ")} ${s.state}`.toLowerCase().includes(t)) : g;
  }, [dir, group, q]);
  const count = (k: string) => (dir?.stations ?? []).filter((s) => (k === "news" ? s.news : k === "local" ? s.local : true)).length;

  return (
    <div className="fx-radio fx-glass" role="dialog" aria-label="Live radio">
      <header className="fx-radio-head">
        <div>
          <div className="fx-radio-title"><Icon name="radio" size={16} /> Live radio <span className="fx-livebadge">LIVE</span></div>
          <div className="fx-sub">Broadcast stations in Nepal, as of now. Not part of the 2024 replay.</div>
        </div>
        <button className="fx-icon-btn" onClick={onClose} aria-label="Close radio"><Icon name="x" size={16} /></button>
      </header>

      {current && (
        <div className={`fx-nowplaying ${state}`}>
          <Eq on={state === "playing"} />
          <div className="fx-np-main">
            <b>{current.name}</b>
            <span>{state === "loading" ? "Connecting to the broadcaster…" : state === "error" ? "This station isn't streaming right now. Try another." : `${current.codec} · ${current.bitrate ? `${current.bitrate} kbps` : "live"}${current.homepage ? " · " : ""}`}{state === "playing" && current.homepage && <a href={current.homepage} target="_blank" rel="noreferrer">website</a>}</span>
          </div>
          <input type="range" min={0} max={1} step={0.05} value={radio.volume} onChange={(e) => radio.setVolume(+e.target.value)} aria-label="Volume" className="fx-vol" />
          <button className="fx-icon-btn" onClick={radio.stop} aria-label="Stop"><span className="fx-stop-sq" /></button>
        </div>
      )}

      <div className="fx-radio-tools">
        <div className="fx-horizon" role="tablist">
          {GROUPS.map((g) => <button key={g.key} role="tab" aria-pressed={group === g.key} onClick={() => setGroup(g.key)}>{g.label} <span className="fx-count">{count(g.key)}</span></button>)}
        </div>
        <input className="fx-radio-search" placeholder="Search stations" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stations" />
      </div>

      <ul className="fx-stations">
        {!dir && !dirErr && Array.from({ length: 6 }, (_, i) => <li key={i} className="fx-st-skel"><i /></li>)}
        {dirErr && <li className="fx-err">Station directory unavailable: {dirErr}</li>}
        {dir && !list.length && <li className="fx-sub" style={{ padding: "10px 12px" }}>No stations match.</li>}
        {list.map((s) => {
          const on = current?.id === s.id;
          return (
            <li key={s.id}>
              <button className={`fx-station${on ? ` on ${state}` : ""}`} onClick={() => (on && state !== "error" ? radio.stop() : radio.play(s))} aria-pressed={on}>
                <span className="fx-st-play">{on && state === "playing" ? <Eq on /> : on && state === "loading" ? <i className="fx-spin" /> : <Icon name="play" size={12} />}</span>
                <span className="fx-st-main">
                  <b>{s.name}</b>
                  <span>{[s.inValley && s.distKm !== null ? `${s.distKm} km from centre` : s.state, s.tags.slice(0, 3).join(", ")].filter(Boolean).join(" · ") || s.language || "Nepal"}</span>
                </span>
                <span className="fx-st-meta">{s.news && <em>news</em>}{s.inValley && <em className="loc">on map</em>}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <footer className="fx-radio-foot">
        Directory: {dir?.source ?? "Radio Browser"} (public domain){dir?.stale ? " · cached list" : ""}. Audio plays straight from each broadcaster under their terms. StormAhead doesn't record or transcribe it.
      </footer>
    </div>
  );
}
