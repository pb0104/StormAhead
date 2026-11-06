import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dataset, PlanEvaluation, PlanningInputs } from "../../../packages/shared/schemas.ts";
import type { ExposureResult } from "../../../packages/analysis/exposure.ts";
import type { AgentEvent } from "../../../packages/agents/orchestrator.ts";
import { api, type Action, type Evaluation, type RunRecord } from "./api.ts";
import { MapView } from "./MapView.tsx";

type Tab = "plans" | "activity" | "review" | "evaluation";
const pct = (x: number) => `${Math.round(x * 100)}%`;
const STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed — awaiting review", approved: "Approved", needs_review: "Needs review", revision_requested: "Revision requested", rejected: "Rejected",
};

export function App() {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [inputs, setInputs] = useState<PlanningInputs | null>(null);
  const [exposure, setExposure] = useState<Record<string, ExposureResult> | null>(null);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [scenarioId, setScenarioId] = useState("HZ-SEV");
  const [planId, setPlanId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("plans");
  const [live, setLive] = useState<AgentEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inbox, setInbox] = useState<Action[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);

  const refreshRun = useCallback(async () => {
    const [{ run }, { actions }] = await Promise.all([api.latest(), api.inbox()]);
    setRun(run); setInbox(actions);
    setPlanId((cur) => (run && run.run.ranked.some((e) => e.plan.id === cur) ? cur : run?.run.ranked[0]?.plan.id ?? null));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.dataset();
        setDs(d.dataset); setInputs(d.inputs);
        setExposure(await api.exposure());
        await refreshRun();
        setEvaluation(await api.evaluation());
      } catch (e) { setError(String((e as Error).message)); }
    })();
  }, [refreshRun]);

  // Live agent events (real tool calls) via SSE.
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("agent-event", (m) => setLive((l) => [...l, JSON.parse((m as MessageEvent).data)]));
    return () => es.close();
  }, []);

  const guard = async (fn: () => Promise<void>) => { setError(null); try { await fn(); } catch (e) { setError((e as Error).message); } };

  const update = (patch: Partial<PlanningInputs>) => guard(async () => {
    const r = await api.setInputs(patch);
    setInputs(r.inputs);
    await refreshRun();
  });

  const generate = () => guard(async () => {
    setBusy(true); setLive([]); setTab("activity");
    try { const r = await api.plan(); setRun(r); setPlanId(r.run.ranked[0]?.plan.id ?? null); setTab("plans"); }
    finally { setBusy(false); }
  });

  const reset = () => guard(async () => { await api.reset(); setLive([]); const d = await api.dataset(); setInputs(d.inputs); await refreshRun(); setEvaluation(await api.evaluation()); });

  const selected: PlanEvaluation | null = useMemo(() => run?.run.ranked.find((e) => e.plan.id === planId) ?? null, [run, planId]);
  if (!ds || !inputs) return <div className="loading">{error ? `Error: ${error}` : "Loading…"}</div>;

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const events = busy ? live : run?.events ?? live;

  return (
    <div className="app">
      <header>
        <div><h1>CascadeIQ</h1><span className="sub">Pre-event staging plans for limited resources</span></div>
        <div className="banner">SIMULATED DATA — invented assets, forecasts and travel times. Not real Nepal facilities. Measures modeled access and coverage, not lives saved.</div>
      </header>
      {error && <div className="error" role="alert">{error} <button onClick={() => setError(null)}>×</button></div>}

      <aside className="left">
        <section>
          <h2>1 · Forecast scenario</h2>
          {ds.hazards.map((h) => (
            <label key={h.id} className="radio">
              <input type="radio" name="sc" checked={scenarioId === h.id} onChange={() => setScenarioId(h.id)} />
              <span><b>{h.label}</b><small>{h.closedEdgeIds.length ? `assumed closed: ${h.closedEdgeIds.join(", ")}` : "no assumed closures"}</small></span>
            </label>
          ))}
          <p className="hint">Map shows the selected scenario. Plans are scored across <b>all</b> scenarios (worst case first).</p>
        </section>

        <section>
          <h2>2 · Resource inventory</h2>
          {(["inspection", "rescue"] as const).map((t) => (
            <div className="row" key={t}>
              <span>{t === "inspection" ? "Inspection teams" : "Rescue teams"}</span>
              <span className="stepper">
                <button disabled={inputs.inventory[t] <= 0} onClick={() => update({ inventory: { ...inputs.inventory, [t]: inputs.inventory[t] - 1 } })}>−</button>
                <b>{inputs.inventory[t]}</b>
                <button disabled={inputs.inventory[t] >= 10} onClick={() => update({ inventory: { ...inputs.inventory, [t]: inputs.inventory[t] + 1 } })}>+</button>
              </span>
            </div>
          ))}
        </section>

        <section>
          <h2>3 · Constraints</h2>
          <h3>Candidate staging sites</h3>
          {ds.sites.map((s) => (
            <label key={s.id} className="check">
              <input type="checkbox" checked={!inputs.disabledSiteIds.includes(s.id)} onChange={() => update({ disabledSiteIds: toggle(inputs.disabledSiteIds, s.id) })} />
              {s.id} {s.name} <small>cap {s.capacity}</small>
            </label>
          ))}
          <h3>Road unavailable <small>(or click a road on the map)</small></h3>
          <div className="roads">
            {ds.roads.map((r) => (
              <button key={r.id} className={`tag ${inputs.extraClosureIds.includes(r.id) ? "on" : ""}`} title={r.name}
                onClick={() => update({ extraClosureIds: toggle(inputs.extraClosureIds, r.id) })}>{r.id}</button>
            ))}
          </div>
          <div className="row"><span>Response threshold</span>
            <span className="stepper">
              <button onClick={() => update({ thresholdMinutes: Math.max(5, inputs.thresholdMinutes - 5) })}>−</button>
              <b>{inputs.thresholdMinutes}m</b>
              <button onClick={() => update({ thresholdMinutes: inputs.thresholdMinutes + 5 })}>+</button>
            </span>
          </div>
        </section>

        <div className="actions">
          <button className="primary" disabled={busy} onClick={generate}>{busy ? "Agents working…" : run ? "Recalculate preparedness plan" : "Generate preparedness plan"}</button>
          <button onClick={reset} disabled={busy}>Reset demo</button>
        </div>
        <div className="legend">
          <i className="l open" /> open <i className="l exposed" /> exposed (passable) <i className="l closed" /> assumed closed <i className="l user" /> your closure
        </div>
      </aside>

      <main>
        <MapView dataset={ds} inputs={inputs} scenarioId={scenarioId} exposure={exposure} evaluation={selected} onToggleRoad={(id) => update({ extraClosureIds: toggle(inputs.extraClosureIds, id) })} />
        <div className="map-note">
          {exposure && <>Exposed in {ds.hazards.find((h) => h.id === scenarioId)!.label}: <b>{exposure[scenarioId]!.exposedEdgeIds.length}</b> segments (<b>{exposure[scenarioId]!.exposedCrossingIds.length}</b> crossings). Exposed ≠ closed. </>}
          Red-ringed places are not covered under the selected plan &amp; scenario (hover for detail).
        </div>
      </main>

      <aside className="right">
        <nav>
          {(["plans", "activity", "review", "evaluation"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {{ plans: "Plans", activity: "Agent activity", review: "Review", evaluation: "Post-event eval" }[t]}
              {t === "review" && run?.status === "needs_review" ? " ⚠" : ""}
            </button>
          ))}
        </nav>
        <div className="panel">
          {tab === "plans" && <Plans ds={ds} run={run} selected={selected} planId={planId} setPlanId={setPlanId} scenarioId={scenarioId} inputs={inputs} />}
          {tab === "activity" && <Activity events={events} busy={busy} />}
          {tab === "review" && <Review run={run} planId={planId} inbox={inbox} guard={guard} refresh={refreshRun} />}
          {tab === "evaluation" && <EvalView ev={evaluation} />}
        </div>
      </aside>
    </div>
  );
}

function Plans({ ds, run, selected, planId, setPlanId, scenarioId, inputs }: {
  ds: Dataset; run: RunRecord | null; selected: PlanEvaluation | null; planId: string | null; setPlanId: (s: string) => void; scenarioId: string; inputs: PlanningInputs;
}) {
  if (!run) return <p className="empty">Choose inputs, then press <b>Generate preparedness plan</b>. Agents will call analytical tools and the top three placements appear here.</p>;
  const name = (id: string) => ds.sites.find((s) => s.id === id)?.name ?? id;
  const sc = selected?.scenarios.find((s) => s.scenarioId === scenarioId);
  return (
    <>
      {run.stale && <div className="warn">Inputs changed since this run — results below are out of date. Recalculate.</div>}
      <div className={`status s-${run.status}`}>{STATUS_LABEL[run.status]}{run.approvedPlanId ? ` · ${run.approvedPlanId}` : ""}</div>
      <p className="headline">{run.brief.headline}</p>
      <p className="meta">{run.run.candidateCount} feasible placements compared · objective: maximise worst-case coverage across scenarios, then minimise worst-case mean response time.</p>
      {run.run.ranked.map((e, i) => (
        <div key={e.plan.id} className={`card ${e.plan.id === planId ? "sel" : ""}`} onClick={() => setPlanId(e.plan.id)}>
          <div className="card-h"><b>#{i + 1} {e.plan.id}</b><span>worst case <b>{pct(e.worstCaseCoverage)}</b> ({e.worstCaseScenarioId})</span></div>
          <ul className="place">{e.plan.placements.map((p) => <li key={p.resourceId}><code>{p.resourceId}</code> → {p.siteId ? `${p.siteId} ${name(p.siteId)}` : <em>unplaced (no capacity)</em>}</li>)}</ul>
          {e.scenarios.map((s) => (
            <div className="bar-row" key={s.scenarioId}>
              <span>{s.scenarioId.replace("HZ-", "")}</span>
              <div className="bar"><div style={{ width: pct(s.coverage) }} /></div>
              <span>{pct(s.coverage)}</span>
              <small>{s.meanResponseMinutes === null ? "no reachable" : `${s.meanResponseMinutes.toFixed(1)} min`}</small>
            </div>
          ))}
          {e.scenarios.some((s) => s.unreachableDemandIds.length || s.lostResourceIds.length) && (
            <div className="issues">
              {e.scenarios.map((s) => (s.unreachableDemandIds.length || s.lostResourceIds.length) ? (
                <div key={s.scenarioId}><b>{s.scenarioId.replace("HZ-", "")}:</b>{" "}
                  {s.unreachableDemandIds.length > 0 && <>unreachable {s.unreachableDemandIds.join(", ")}. </>}
                  {s.lostResourceIds.length > 0 && <>lost (ineligible site) {s.lostResourceIds.join(", ")}.</>}</div>
              ) : null)}
            </div>
          )}
        </div>
      ))}
      {sc && selected && (
        <>
          <h3>{selected.plan.id} in {scenarioId} · demand detail</h3>
          <table><thead><tr><th>Demand</th><th>Status</th><th>Min</th><th>By</th></tr></thead><tbody>
            {sc.demands.map((d) => (
              <tr key={d.demandId} className={`st-${d.status}`}>
                <td>{ds.demands.find((x) => x.id === d.demandId)!.name}</td><td>{d.status}</td><td>{d.minutes ?? "—"}</td><td>{d.servedBy ?? "—"}</td>
              </tr>))}
          </tbody></table>
          <p className="meta">covered = nearest compatible resource within {inputs.thresholdMinutes} min · late = reachable but slower · "—" means no finite travel time exists.</p>
        </>
      )}
      <h3>Tradeoffs vs. recommended</h3>
      <ul className="plain">{run.brief.tradeoffs.map((t, i) => <li key={i}>{t}</li>)}</ul>
      <h3>Scenario findings</h3>
      <ul className="plain">{run.brief.scenarioFindings.map((t, i) => <li key={i}>{t}</li>)}</ul>
      <details><summary>Assumptions &amp; limitations</summary>
        <ul className="plain">{[...run.brief.assumptions, ...run.brief.limitations].map((t, i) => <li key={i}>{t}</li>)}</ul></details>
      <details open={run.brief.unresolvedInputs.length > 0}><summary>Unresolved inputs ({run.brief.unresolvedInputs.length})</summary>
        <ul className="plain">{run.brief.unresolvedInputs.map((t, i) => <li key={i}>{t}</li>)}</ul></details>
      <details><summary>Evidence ({run.brief.evidence.length})</summary>
        <ul className="plain">{run.brief.evidence.map((e) => (
          <li key={e.id}><code>{e.id}</code> {e.title} — <em>{e.status}</em>, {e.phase}; observed {e.observedAt?.slice(0, 10) ?? "n/a"}, available {e.availableAt.slice(0, 10)}, retrieved {e.retrievedAt.slice(0, 10)}</li>))}</ul></details>
    </>
  );
}

function Activity({ events, busy }: { events: AgentEvent[]; busy: boolean }) {
  if (!events.length) return <p className="empty">No workflow run yet. Events listed here are real tool calls — nothing is invented reasoning.</p>;
  return (
    <>
      <p className="meta">Mode: <b>deterministic, rule-based agent modules</b> (no LLM). Each row is an actual tool invocation.{busy && " Running…"}</p>
      <ol className="events">
        {events.map((e) => (
          <li key={e.id}>
            <div><span className="agent">{e.agent}</span> → <code>{e.tool}</code></div>
            <div className="sum">{e.summary}</div>
            {e.evidenceIds.length > 0 && <div className="ev">{e.evidenceIds.slice(0, 6).map((x) => <code key={x}>{x}</code>)}{e.evidenceIds.length > 6 && <code>+{e.evidenceIds.length - 6}</code>}</div>}
          </li>))}
      </ol>
    </>
  );
}

function Review({ run, planId, inbox, guard, refresh }: { run: RunRecord | null; planId: string | null; inbox: Action[]; guard: (f: () => Promise<void>) => Promise<void>; refresh: () => Promise<void> }) {
  const [reviewer, setReviewer] = useState("Duty Officer (demo)");
  const [notes, setNotes] = useState("");
  if (!run) return <p className="empty">Generate a plan first. Nothing can be assigned before an official approves a plan.</p>;
  const decide = (decision: string) => guard(async () => { await api.review(run.id, { decision, reviewer, planId: planId ?? undefined, notes: notes || undefined }); await refresh(); });
  const mine = inbox.filter((a) => a.runId === run.id);
  return (
    <>
      <div className={`status s-${run.status}`}>{STATUS_LABEL[run.status]}</div>
      {run.status === "needs_review" && <div className="warn">Forecast/inventory/constraints changed after approval. This plan and its assignments are <b>Needs review</b>. Recalculate and re-approve.</div>}
      {run.stale && run.status !== "needs_review" && <div className="warn">Inputs changed — recalculate before approving.</div>}
      <label className="field">Reviewer<input value={reviewer} onChange={(e) => setReviewer(e.target.value)} /></label>
      <label className="field">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></label>
      <p className="meta">Selected plan: <b>{planId ?? "none"}</b> (choose on the Plans tab)</p>
      <div className="actions">
        <button className="primary" disabled={!planId || run.stale || run.status === "approved"} onClick={() => decide("approve")}>Approve plan</button>
        <button disabled={run.status === "approved"} onClick={() => decide("request_revision")}>Request revision</button>
        <button disabled={run.status === "approved"} onClick={() => decide("reject")}>Reject</button>
      </div>
      <div className="actions">
        <button className="primary" disabled={run.status !== "approved" || run.stale || mine.length > 0}
          onClick={() => guard(async () => { await api.assign(run.id); await refresh(); })}>Create simulated assignments</button>
      </div>
      {run.reviewer && <p className="meta">Last decision by {run.reviewer} at {run.reviewedAt?.slice(11, 19)}Z{run.notes ? ` — “${run.notes}”` : ""}</p>}
      <h3>Simulated authority inbox</h3>
      {inbox.length === 0 ? <p className="empty">Empty. No real messages are ever sent.</p> : (
        <ul className="inbox">{inbox.map((a) => (
          <li key={a.id} className={a.status}><span className="tagsim">SIMULATED</span> <b>{a.owner}</b><div>{a.task}</div>
            <small>{a.planId} · approved by {a.reviewer} · {a.status === "needs_review" ? "NEEDS REVIEW" : "assigned"}</small></li>))}</ul>
      )}
    </>
  );
}

function EvalView({ ev }: { ev: Evaluation | null }) {
  if (!ev) return null;
  return (
    <>
      <div className="warn neutral">Separate evaluation view. Post-event material never feeds the planning engine (enforced by a temporal guard + tests).</div>
      <p>{ev.message}</p>
      <table><thead><tr><th>Source</th><th>Status</th></tr></thead><tbody>
        {ev.evidence.map((e) => (
          <tr key={e.id}><td><a href={e.sourceUrl ?? "#"} target="_blank" rel="noreferrer">{e.title}</a><br /><small>observed {e.observedAt?.slice(0, 10) ?? "n/a"} · available {e.availableAt.slice(0, 10)} · {e.note}</small></td><td>{ev.connected ? "connected" : "NOT connected"}</td></tr>))}
      </tbody></table>
      <p className="meta">Latest pre-event recommendation (synthetic): {ev.latestRecommendation ?? "none yet"}</p>
    </>
  );
}
