/** The situation report: headline numbers, daily rain, the LLM-written brief, the priority list and the evidence. */
import { useState } from "react";
import { Icon } from "./Icon.tsx";
import { Markdown } from "./Markdown.tsx";
import type { AgentMeta, AgentResult, Combined, MapAlert, Risk, Window } from "./api.ts";

const ORDER: Risk[] = ["severe", "high", "moderate", "low"];
const SEV_ORDER = ["severe", "high", "moderate", "info"];

export type ReportProps = {
  window: Window; question: string; agents: AgentMeta[]; results: Record<string, AgentResult>; combined: Combined[];
  report: { markdown: string; by: "stackai" | "rules"; error?: string } | null; daily: { day: string; mm: number }[] | null;
  activeAlert: string | null; onAlert: (id: string) => void; onClose: () => void; approved: boolean; onApprove: () => void;
};

function DailyRain({ daily }: { daily: { day: string; mm: number }[] }) {
  const max = Math.max(1, ...daily.map((d) => d.mm)), top = daily.find((d) => d.mm === max);
  return (
    <>
    <div className="fx-daily-cap"><span>Daily rain, valley mean</span>{top && <b>Wettest: {top.day}, {Math.round(top.mm)} mm</b>}</div>
    <div className="fx-daily" aria-label="Daily valley-mean rain">
      {daily.map((d, i) => (
        <div key={i} className="fx-daily-col" title={`${d.day}: ${d.mm} mm`}>
          <i style={{ height: `${Math.max(3, (d.mm / max) * 100)}%` }} className={d.mm >= 60 ? "hot" : d.mm >= 25 ? "warm" : ""} />
          {(i === 0 || i === daily.length - 1) && <span style={i === 0 ? { left: 0, transform: "none" } : { left: "auto", right: 0, transform: "none" }}>{d.day.replace(/^\w+ /, "")}</span>}
        </div>
      ))}
    </div>
    </>
  );
}

export function ReportPanel(p: ReportProps) {
  const [tab, setTab] = useState<"brief" | "priorities" | "evidence">("brief");
  const [copied, setCopied] = useState(false);
  const res = Object.entries(p.results);
  const worst = res.map(([, r]) => r.risk).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0] ?? "low";
  const alerts: MapAlert[] = res.flatMap(([, r]) => r.alerts).sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  const p1 = p.combined.filter((c) => c.priority === "P1").length;
  const name = new Map(p.agents.map((a) => [a.id, a.factor]));
  const peak = p.results["weather"]?.facts["max24hMm"];
  const copy = async () => { if (!p.report) return; try { await navigator.clipboard.writeText(p.report.markdown); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ } };
  const download = () => {
    if (!p.report) return;
    const blob = new Blob([`# StormAhead situation report: ${p.window.label}\n\n_${p.window.startLabel} → ${p.window.endLabel}. ${p.window.replayNote}_\n\n${p.report.markdown}\n`], { type: "text/markdown" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `stormahead-sitrep-${p.window.hours}h.md`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <aside className="fx-report fx-glass" aria-label="Situation report">
      <header className="fx-report-head">
        <div className="fx-report-top">
          <span className="fx-draft"><Icon name="shield" size={13} /> {p.approved ? "Approved draft · nothing sent" : "Draft · needs approval"}</span>
          <button className="fx-icon-btn" onClick={p.onClose} aria-label="Close report"><Icon name="x" size={16} /></button>
        </div>
        <h2>Situation report · {p.window.label}</h2>
        <p className="fx-sub">{p.window.startLabel} → {p.window.endLabel} · Kathmandu valley</p>
        <div className="fx-kpis">
          <div className={`fx-kpi risk-${worst}`}><span>Overall risk</span><b>{worst}</b></div>
          <div className="fx-kpi"><span>Priority 1</span><b>{p1}</b></div>
          <div className="fx-kpi"><span>Map alerts</span><b>{alerts.length}</b></div>
          <div className="fx-kpi"><span>Peak 24 h rain</span><b>{peak !== undefined ? `${peak} mm` : "n/a"}</b></div>
        </div>
        {p.daily && p.daily.length > 1 && <DailyRain daily={p.daily} />}
        <div className="fx-tabs" role="tablist">
          {(["brief", "priorities", "evidence"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === "brief" ? "Brief" : t === "priorities" ? `Priorities · ${p.combined.length + alerts.length}` : "Evidence"}</button>
          ))}
        </div>
      </header>
      <div className="fx-report-body">
        {tab === "brief" && (p.report ? (
          <>
            <div className={`fx-by ${p.report.by}`}><Icon name="sparkle" size={13} /> {p.report.by === "stackai" ? "Written by the LLM (StackAI) from the agents' numbers" : "Written by rules: LLM unavailable"}{p.report.error ? ` · ${p.report.error}` : ""}</div>
            <Markdown text={p.report.markdown} />
          </>
        ) : (
          <div className="fx-skeleton" aria-busy="true"><i /><i /><i className="s" /><i /><i className="s" /><i /></div>
        ))}
        {tab === "priorities" && (
          <div className="fx-prio">
            {p.combined.length > 0 && <h4>Combined findings</h4>}
            {p.combined.map((c) => (
              <button key={c.id} className={`fx-prio-item combined sev-${c.severity}${p.activeAlert === c.id ? " active" : ""}`} onClick={() => p.onAlert(c.id)}>
                <span className={`fx-badge ${c.priority}`}>{c.priority}</span>
                <span className="fx-prio-main">
                  <b>{c.title}</b>
                  <span className="fx-prio-why">{c.why.join(" · ")}</span>
                  <span className="fx-prio-meta">{c.agents.map((a) => name.get(a)).join(" + ")}{c.when ? ` · from ${c.when}` : ""}</span>
                  {c.coverage && (
                    <span className={`fx-cov ${c.coverage.status}`}>
                      {c.coverage.status === "none" ? "No action yet"
                        : c.coverage.status === "partial" ? `${c.coverage.resources.join(", ") || "Help"} on site · ~${c.coverage.remaining?.toLocaleString("en-US")} may remain (est.)`
                        : `${c.coverage.resources.join(", ") || "Help"} on site · looks covered`}
                    </span>
                  )}
                </span>
              </button>
            ))}
            <h4>All alerts</h4>
            {alerts.map((a) => (
              <button key={a.id} className={`fx-prio-item sev-${a.severity}${p.activeAlert === a.id ? " active" : ""}`} onClick={() => p.onAlert(a.id)}>
                <i className="fx-dot" />
                <span className="fx-prio-main">
                  <b>{a.title}</b>
                  <span className="fx-prio-meta">{name.get(a.agent)}{a.when ? ` · ${a.when}` : ""}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {tab === "evidence" && (
          <div className="fx-evidence">
            <p className="fx-replay"><Icon name="info" size={13} /> {p.window.replayNote}</p>
            {res.map(([id, r]) => (
              <section key={id}>
                <h4><Icon name={id} size={14} /> {name.get(id)} <span className={`fx-risk risk-${r.risk}`}>{r.risk}</span></h4>
                <dl>{Object.entries(r.facts).map(([k, v]) => <div key={k}><dt>{k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</dt><dd>{String(v)}</dd></div>)}</dl>
                {r.caveats.map((c, i) => <p key={i} className="fx-caveat">{c}</p>)}
              </section>
            ))}
          </div>
        )}
      </div>
      <footer className="fx-report-foot">
        <button className="fx-btn primary" onClick={p.onApprove} disabled={!p.report || p.approved}><Icon name="check" size={15} />{p.approved ? "Approved" : "Approve draft"}</button>
        <button className="fx-btn" onClick={copy} disabled={!p.report}><Icon name="copy" size={15} />{copied ? "Copied" : "Copy"}</button>
        <button className="fx-btn" onClick={download} disabled={!p.report}><Icon name="download" size={15} />.md</button>
      </footer>
    </aside>
  );
}
