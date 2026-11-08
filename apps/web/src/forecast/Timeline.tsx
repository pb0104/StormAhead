/** Forecast-window scrubber: hourly rain bars, alert ticks and a play head. Moving it drives rain, flood stage and pins. */
import { useRef } from "react";
import { Icon } from "./Icon.tsx";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function labelAt(startIso: string, h: number) {
  const d = new Date(Date.parse(`${startIso}:00Z`) + h * 3.6e6);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:00`;
}

export type TimelineProps = {
  startIso: string; hours: number; hourly: number[]; ticks: { h: number; severity: string }[];
  cursor: number; setCursor: (h: number) => void; playing: boolean; setPlaying: (b: boolean) => void; peak: number | null;
  /** Live line under the time, e.g. water level and river stage. */
  readout?: string;
  /** 0..1 water level per hour, drawn as a filled curve behind the rain bars. */
  level?: number[] | null;
  /** Close the replay: the timeline goes away and the map holds the peak water moment. */
  onClose?: () => void;
};

export function Timeline(p: TimelineProps) {
  const svg = useRef<SVGSVGElement>(null);
  const W = 1000, H = 44, max = Math.max(1, ...p.hourly);
  const bw = W / Math.max(1, p.hours);
  const scrub = (clientX: number) => {
    const r = svg.current?.getBoundingClientRect(); if (!r) return;
    p.setCursor(Math.max(0, Math.min(p.hours, Math.round(((clientX - r.left) / r.width) * p.hours))));
  };
  return (
    <div className="fx-timeline fx-glass">
      <button className="fx-play" onClick={() => p.setPlaying(!p.playing)} aria-label={p.playing ? "Pause replay" : "Play the forecast window"}>
        <Icon name={p.playing ? "pause" : "play"} size={15} />
      </button>
      <div className="fx-tl-main">
        <div className="fx-tl-labels">
          <span>{labelAt(p.startIso, 0)}</span>
          <b>{labelAt(p.startIso, p.cursor)} · {(p.hourly[Math.min(p.cursor, p.hourly.length - 1)] ?? 0).toFixed(1)} mm/h</b>
          <span>{labelAt(p.startIso, p.hours)}</span>
        </div>
        {p.readout && <div className="fx-tl-readout"><i />{p.readout}</div>}
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="fx-tl-svg" role="slider" aria-label="Forecast time" aria-valuemin={0} aria-valuemax={p.hours} aria-valuenow={p.cursor} tabIndex={0}
          onKeyDown={(e) => { if (e.key === "ArrowRight") p.setCursor(Math.min(p.hours, p.cursor + 3)); if (e.key === "ArrowLeft") p.setCursor(Math.max(0, p.cursor - 3)); }}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); p.setPlaying(false); scrub(e.clientX); }}
          onPointerMove={(e) => { if (e.buttons) scrub(e.clientX); }}>
          {p.level && p.level.length > 1 && (
            <path className="water" d={`M0 ${H} ${p.level.map((v, i) => `L${(i * bw).toFixed(1)} ${(H - 2 - v * (H - 10)).toFixed(1)}`).join(" ")} L${((p.level.length - 1) * bw).toFixed(1)} ${H} Z`} />
          )}
          {p.hourly.map((v, i) => v > 0 && (
            <rect key={i} x={i * bw} width={Math.max(0.6, bw * 0.8)} y={H - 6 - (v / max) * (H - 14)} height={(v / max) * (H - 14)} className={i <= p.cursor ? "past" : ""} />
          ))}
          {Array.from({ length: Math.floor(p.hours / 24) + 1 }, (_, d) => <line key={d} x1={d * 24 * bw} x2={d * 24 * bw} y1={H - 4} y2={H} className="day" />)}
          {p.ticks.map((t, i) => <circle key={i} cx={t.h * bw} cy={4} r={2.6} className={`tick sev-${t.severity}`} />)}
          {p.peak !== null && <line x1={p.peak * bw} x2={p.peak * bw} y1={8} y2={H - 6} className="peak" />}
          <line x1={p.cursor * bw} x2={p.cursor * bw} y1={0} y2={H} className="head" />
        </svg>
      </div>
      {p.onClose && (
        <button type="button" className="fx-tl-close" onClick={p.onClose} aria-label="Close replay" title="Close replay and show the peak water moment">
          <Icon name="x" size={15} />
        </button>
      )}
    </div>
  );
}
