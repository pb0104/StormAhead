/** The agent operations panel: one live card per agent, then the coordinator (fusion) and briefing (report) cards. */
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.tsx";
import type { AgentMeta, AgentResult, Combined } from "./api.ts";

export type AgentState = { status: "queued" | "running" | "done"; steps: { kind: string; text: string }[]; result?: AgentResult; ms?: number };

/** Types the newest line out, so a person can follow the agent as it works. */
function Typed({ text, live }: { text: string; live: boolean }) {
  const [n, setN] = useState(live ? 0 : text.length);
  useEffect(() => {
    if (!live) { setN(text.length); return; }
    setN(0);
    const step = Math.max(1, Math.round(text.length / 40));
    const t = window.setInterval(() => setN((v) => { if (v + step >= text.length) { window.clearInterval(t); return text.length; } return v + step; }), 16);
    return () => window.clearInterval(t);
  }, [text, live]);
  return <>{text.slice(0, n)}{live && n < text.length && <i className="fx-caret" />}</>;
}

const KIND_ICON: Record<string, string> = { read: "read", calc: "calc", found: "found", llm: "sparkle" };
const RISK_LABEL: Record<string, string> = { low: "Low", moderate: "Moderate", high: "High", severe: "Severe" };

function AgentCard({
  meta, s, open, onToggle, onAlert,
}: {
  meta: AgentMeta; s: AgentState; open: boolean;
  onToggle: () => void; onAlert: (id: string) => void;
}) {
  const log = useRef<HTMLOListElement>(null);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [s.steps.length, s.result]);
  const r = s.result, showSteps = s.status !== "done" || open;
  return (
    <article className={`fx-agent is-${s.status}${r ? ` risk-${r.risk}` : ""}`} aria-busy={s.status === "running"}>
      <div className="fx-agent-head static">
        <span className="fx-agent-ico"><Icon name={meta.id} size={17} /></span>
        <span className="fx-agent-id">
          <span className="fx-agent-name">{meta.name}</span>
          <span className="fx-agent-src">{meta.sources}</span>
        </span>
        {s.status === "queued" && <span className="fx-state">Queued</span>}
        {s.status === "running" && <span className="fx-state run"><i className="fx-spin" />Working</span>}
        {s.status === "done" && r && <span className={`fx-risk risk-${r.risk}`}>{RISK_LABEL[r.risk]}</span>}
      </div>
      {s.status === "running" && <div className="fx-agent-bar"><i /></div>}
      <div className="fx-agent-body">
        {s.status === "done" && (
          <button className="fx-steps-toggle" onClick={onToggle} aria-expanded={showSteps}>
            <Icon name="chevron" size={12} className={showSteps ? "up" : ""} /> {showSteps ? "Hide" : "Show"} {s.steps.length} data steps{s.ms ? ` · ${(s.ms / 1000).toFixed(1)}s` : ""}
          </button>
        )}
        {showSteps && (
          <ol className="fx-steps" ref={log}>
            {s.steps.map((st, i) => {
              const live = s.status === "running" && i === s.steps.length - 1;
              return (
                <li key={i} className={`k-${st.kind}`}>
                  <Icon name={KIND_ICON[st.kind] ?? "calc"} size={13} />
                  <span><Typed text={st.text} live={live} /></span>
                </li>
              );
            })}
          </ol>
        )}
        {r && (
          <div className="fx-think">
            <div className="fx-think-h">
              <Icon name="sparkle" size={13} />
              {r.by === "stackai" ? "Reasoning · LLM" : "Summary · rules (LLM offline)"}
            </div>
            <ul>{r.thinking.map((t, i) => <li key={i}>{t}</li>)}</ul>
            {r.figures && r.figures.length > 0 && (
              <dl className="fx-figures">
                {r.figures.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}{f.note && <small>{f.note}</small>}</dd></div>)}
              </dl>
            )}
            {Array.isArray(r.map?.["fleet"]) && (r.map!["fleet"] as unknown[]).length > 0 && (
              <table className="fx-spend fx-fleet">
                <caption>Vehicles needed each day · {String(r.map!["fleetPerDayLabel"] ?? "")} in hire</caption>
                <thead><tr><th>Vehicle</th><th>No.</th><th>Each / day</th><th>Total</th></tr></thead>
                <tbody>
                  {(r.map!["fleet"] as { type: string; label: string; count: number; perDayEachLabel: string; perDayLabel: string }[]).map((f) => (
                    <tr key={f.type}><td>{f.label}</td><td>{f.count}</td><td>{f.perDayEachLabel}</td><td>{f.perDayLabel}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {Array.isArray(r.map?.["areas"]) && (r.map!["areas"] as unknown[]).length > 0 && (() => {
              const areas = r.map!["areas"] as { place: string; people: number; perDayLabel: string; by: string }[];
              return (
                <table className="fx-spend">
                  <caption>Daily spend by area</caption>
                  <tbody>
                    {areas.slice(0, 8).map((a) => <tr key={a.place}><td>{a.place}{a.by === "helicopter" && <span className="fx-spend-tag">heli</span>}</td><td>~{a.people.toLocaleString("en-US")} people</td><td>{a.perDayLabel}</td></tr>)}
                  </tbody>
                  {areas.length > 8 && <tfoot><tr><td colSpan={3}>+ {areas.length - 8} more areas. Click any area on the map for its census and costs.</td></tr></tfoot>}
                </table>
              );
            })()}
            <p className="fx-agent-headline strong">{r.headline}</p>
            {r.watch && <p className="fx-watch"><Icon name="clock" size={13} /> {r.watch}</p>}
            {r.alerts.length > 0 && (
              <div className="fx-agent-alerts">
                {r.alerts.map((a) => <button key={a.id} className={`fx-mini sev-${a.severity}`} onClick={() => onAlert(a.id)}><i />{a.title}</button>)}
              </div>
            )}
            {r.llmError && <p className="fx-err">LLM: {r.llmError}</p>}
          </div>
        )}
      </div>
    </article>
  );
}

export type BoardProps = {
  agents: AgentMeta[]; order: string[]; state: Record<string, AgentState>;
  fusion: string[]; combined: Combined[] | null; reportState: "idle" | "writing" | "done"; reportBy?: "stackai" | "rules";
  elapsed: number; minimized: boolean; tallDock?: boolean; setMinimized: (b: boolean) => void; onAlert: (id: string) => void; llmConfigured: boolean;
};

export function AgentBoard(p: BoardProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const done = p.order.filter((id) => p.state[id]?.status === "done").length;
  const byId = new Map(p.agents.map((a) => [a.id, a]));
  if (p.minimized) {
    return (
      <button className="fx-board-pill fx-glass" onClick={() => p.setMinimized(false)}>
        <span className="fx-pill-dots">{p.order.map((id) => <i key={id} className={`risk-${p.state[id]?.result?.risk ?? "none"}`} />)}</span>
        {done}/{p.order.length} agents · view reasoning
      </button>
    );
  }
  return (
    <aside className={`fx-board fx-glass${p.tallDock ? " tall-dock" : ""}`} aria-label="Agent operations">
      <header className="fx-board-head">
        <div>
          <div className="fx-eyebrow">Agent operations</div>
          <div className="fx-board-title">{done < p.order.length ? `${p.order.length - done} agents working in parallel` : p.reportState === "done" ? "Assessment complete" : "Fusing findings"}</div>
        </div>
        <div className="fx-board-meta">
          <span className="fx-mono">{(p.elapsed / 1000).toFixed(1)}s</span>
          <button className="fx-icon-btn" onClick={() => p.setMinimized(true)} aria-label="Minimise agent panel"><Icon name="chevron" size={16} /></button>
        </div>
      </header>
      <div className="fx-progress" role="progressbar" aria-valuemin={0} aria-valuemax={p.order.length} aria-valuenow={done}><i style={{ width: `${(done / Math.max(1, p.order.length)) * 100}%` }} /></div>
      {!p.llmConfigured && <p className="fx-note"><Icon name="info" size={13} />The LLM isn't connected, so agents summarise with rules.</p>}
      <div className="fx-agents">
        {p.order.map((id) => {
          const meta = byId.get(id); const s = p.state[id];
          if (!meta || !s) return null;
          return (
            <AgentCard
              key={id}
              meta={meta}
              s={s}
              open={!!open[id]}
              onToggle={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}
              onAlert={p.onAlert}
            />
          );
        })}
        {(p.fusion.length > 0 || p.combined) && (
          <article className={`fx-agent fx-sys ${p.combined ? "is-done" : "is-running"}`}>
            <div className="fx-agent-head static">
              <span className="fx-agent-ico sys"><Icon name="fusion" size={17} /></span>
              <span className="fx-agent-id"><span className="fx-agent-name">Coordinator · fusion</span><span className="fx-agent-src">Cross-checks alerts across agents</span></span>
              {p.combined ? <span className="fx-state">{p.combined.filter((c) => c.priority === "P1").length} × P1</span> : <span className="fx-state run"><i className="fx-spin" />Fusing</span>}
            </div>
            <ol className="fx-steps">{p.fusion.map((t, i) => <li key={i} className="k-found"><Icon name="found" size={13} /><span>{t}</span></li>)}</ol>
          </article>
        )}
        {p.reportState !== "idle" && (
          <article className={`fx-agent fx-sys ${p.reportState === "done" ? "is-done" : "is-running"}`}>
            <div className="fx-agent-head static">
              <span className="fx-agent-ico sys"><Icon name="doc" size={17} /></span>
              <span className="fx-agent-id"><span className="fx-agent-name">Briefing agent</span><span className="fx-agent-src">{p.llmConfigured ? "Writes the situation report with the LLM" : "Writes the situation report (rules, LLM offline)"}</span></span>
              {p.reportState === "writing" ? <span className="fx-state run"><i className="fx-spin" />Writing</span> : <span className="fx-state">{p.reportBy === "stackai" ? "LLM" : "Rules"}</span>}
            </div>
          </article>
        )}
      </div>
    </aside>
  );
}
