import { useMemo, useRef, useState } from "react";
import type { SeriesHour } from "./api.ts";

const W = 460, PAD = { l: 34, r: 10, t: 10, b: 20 };
const dayLabel = (t: string) => new Date(`${t.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const hourLabel = (t: string) => `${dayLabel(t)}, ${t.slice(11, 13)}:00`;

type Props = { hours: SeriesHour[]; date: string; hover: number | null; setHover: (i: number | null) => void };

/** Shared frame: x axis by day, the selected day as a band, and a crosshair with a tooltip. */
function Frame({ hours, date, hover, setHover, h, ticks, tip, label, children }: Props & { h: number; ticks: { v: number; y: number }[]; tip: string | null; label: string; children: (x: (i: number) => number) => React.ReactNode }) {
  const ref = useRef<SVGSVGElement>(null);
  const x = (i: number) => PAD.l + (i / Math.max(1, hours.length - 1)) * (W - PAD.l - PAD.r);
  const days = hours.flatMap((p, i) => (p.t.endsWith("T00") ? [{ i, t: p.t }] : []));
  const sel = hours.flatMap((p, i) => (p.t.startsWith(date) ? [i] : []));
  const move = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const i = Math.round((((e.clientX - r.left) / r.width) * W - PAD.l) / ((W - PAD.l - PAD.r) / Math.max(1, hours.length - 1)));
    setHover(i >= 0 && i < hours.length ? i : null);
  };
  return (
    <div className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${h}`} role="img" aria-label={label} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        {sel.length > 0 && <rect className="band" x={x(sel[0]!)} y={PAD.t} width={x(sel[sel.length - 1]!) - x(sel[0]!)} height={h - PAD.t - PAD.b} />}
        {ticks.map((t) => <g key={t.v}><line className="grid" x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y} /><text className="ax" x={PAD.l - 5} y={t.y + 3} textAnchor="end">{t.v}</text></g>)}
        {days.map((d) => <text key={d.t} className="ax" x={x(d.i)} y={h - 6} textAnchor="start">{dayLabel(d.t)}</text>)}
        {children(x)}
        {hover !== null && <line className="cross" x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={h - PAD.b} />}
      </svg>
      {hover !== null && tip && <div className="tip" style={{ left: `${(x(hover) / W) * 100}%` }} data-flip={hover > hours.length * 0.6 ? "1" : undefined}>{tip}</div>}
    </div>
  );
}

function RiverChart(p: Props & { warning: number; danger: number; station: string }) {
  const h = 150, vals = p.hours.flatMap((q) => (q.stage === null ? [] : [q.stage]));
  const top = Math.ceil(Math.max(p.danger + 1, ...vals));
  const y = (v: number) => PAD.t + (1 - v / top) * (h - PAD.t - PAD.b);
  const ticks = Array.from({ length: Math.floor(top / 2) + 1 }, (_, k) => ({ v: k * 2, y: y(k * 2) }));
  const lastIdx = p.hours.reduce((a, q, i) => (q.stage !== null ? i : a), -1);
  const q = p.hover === null ? null : p.hours[p.hover]!;
  const tip = q && `${hourLabel(q.t)} · ${q.stage === null ? "no reading" : `${q.stage.toFixed(2)} m`}`;
  return (
    <Frame {...p} h={h} ticks={ticks} tip={tip} label={`${p.station} river level, hourly, with warning at ${p.warning} m and danger at ${p.danger} m`}>
      {(x) => {
        const segs: string[] = []; let cur = "";
        p.hours.forEach((r, i) => { if (r.stage === null) { if (cur) segs.push(cur); cur = ""; } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(r.stage).toFixed(1)}`; });
        if (cur) segs.push(cur);
        return <>
          {([[p.danger, "danger"], [p.warning, "warning"]] as const).map(([v, n]) => <g key={n}><line className={`lvl ${n}`} x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} /><text className="ax lvl-t" x={PAD.l + 4} y={y(v) + (n === "danger" ? -3 : 10)}>{n} {v} m</text></g>)}
          {segs.map((d, i) => <path key={i} className="river" d={d} />)}
          {lastIdx >= 0 && lastIdx < p.hours.length - 6 && <text className="ax gap" x={x(lastIdx) + 6} y={PAD.t + 12}>no readings after this</text>}
          {p.hover !== null && p.hours[p.hover]!.stage !== null && <circle className="dot" cx={x(p.hover)} cy={y(p.hours[p.hover]!.stage!)} r={4} />}
        </>;
      }}
    </Frame>
  );
}

function RainChart(p: Props) {
  const h = 92, vals = p.hours.flatMap((q) => (q.rain === null ? [] : [q.rain]));
  const top = Math.max(5, Math.ceil(Math.max(...vals, 0) / 5) * 5);
  const y = (v: number) => PAD.t + (1 - v / top) * (h - PAD.t - PAD.b);
  const q = p.hover === null ? null : p.hours[p.hover]!;
  const tip = q && `${hourLabel(q.t)} · ${q.rain === null ? "no reading" : `${q.rain.toFixed(1)} mm`}`;
  const bw = Math.max(1, (W - PAD.l - PAD.r) / p.hours.length - 0.6);
  return (
    <Frame {...p} h={h} ticks={[0, top].map((v) => ({ v, y: y(v) }))} tip={tip} label="Median valley rain in millimetres per hour">
      {(x) => p.hours.map((r, i) => (r.rain === null || r.rain <= 0 ? null : <rect key={i} className="rain" x={x(i) - bw / 2} y={y(r.rain)} width={bw} height={y(0) - y(r.rain)} rx={0.8} />))}
    </Frame>
  );
}

/** River and rain share one time axis but stay separate charts, because they have different units. */
export function GaugeCharts({ hours, date, warning, danger, station }: { hours: SeriesHour[]; date: string; warning: number; danger: number; station: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const hasRiver = useMemo(() => hours.some((q) => q.stage !== null), [hours]);
  const shared = { hours, date, hover, setHover };
  return <>
    <h3>{station}, river level (m)</h3>
    {hasRiver ? <RiverChart {...shared} warning={warning} danger={danger} station={station} /> : <p className="meta">No river readings around this date.</p>}
    <h3>Valley rain, median across stations (mm per hour)</h3>
    <RainChart {...shared} />
  </>;
}
