/** Analyst action updates UI: the one-line confirmation, the follow-up suggestion, and the per-location history panel. */
import { Icon } from "./Icon.tsx";
import { hhmm, locationLabel, type ActionsView, type NextRec, type Proposal } from "./actionsApi.ts";

const KIND_LABEL: Record<string, string> = { dispatch: "Dispatch", evacuate: "Evacuation", supply: "Supplies", shelter: "Shelter", rescue: "Rescue", alert: "Alert", road: "Road", other: "Action" };

export function UpdateConfirm({ p, busy, onConfirm, onEdit, onCancel, onPick, picking }: {
  p: Proposal; busy: boolean; onConfirm: () => void; onEdit: () => void; onCancel: () => void;
  onPick: (i: number, field: "place" | "dest") => void; picking: { i: number; field: "place" | "dest" } | null;
}) {
  // One pick per distinct unknown name (the same name can appear in several actions or fields).
  const unresolved = p.actions.flatMap((a, i) => [
    ...(a.placeText && !a.place ? [{ i, field: "place" as const, text: a.placeText }] : []),
    ...(a.destText && !a.dest ? [{ i, field: "dest" as const, text: a.destText }] : []),
  ]).filter((u, k, arr) => arr.findIndex((x) => x.text.toLowerCase() === u.text.toLowerCase()) === k);
  const matched = p.actions.flatMap((a) => [a.place, a.dest]).filter((r, i, arr): r is NonNullable<typeof r> => !!r && arr.findIndex((x) => x?.name === r.name) === i);
  return (
    <div className="fx-confirm fx-glass" role="dialog" aria-label="Confirm update">
      <div className="fx-confirm-top">
        <span className="fx-eyebrow"><Icon name="check" size={12} /> Log update · {p.by === "stackai" ? "read by the LLM" : "read by rules"}</span>
        <button className="fx-icon-btn" onClick={onCancel} aria-label="Cancel"><Icon name="x" size={15} /></button>
      </div>
      {p.actions.length > 0 && <p className="fx-confirm-line">{p.line}</p>}
      {p.actions.length > 0 && (
        <div className="fx-confirm-chips">
          {p.actions.map((a, i) => <span key={i} className={`fx-kind k-${a.kind}`}>{KIND_LABEL[a.kind]}{a.resource ? ` · ${a.resource}` : ""}{a.people !== null ? ` · ${a.people}` : ""}</span>)}
          {matched.map((m) => <span key={m.name} className="fx-match" title={`Matched to ${m.name} (${m.kind})`}><Icon name="found" size={11} /> {m.name} <em>{m.kind}</em></span>)}
        </div>
      )}
      {(p.warnings.length > 0 || unresolved.length > 0) && (
        <div className="fx-confirm-warn">
          {p.warnings.map((w, i) => <span key={i}><Icon name="alert" size={12} /> {w}</span>)}
          {unresolved.map((u) => (
            <button key={`${u.i}${u.field}`} className={`fx-link${picking?.i === u.i && picking.field === u.field ? " on" : ""}`} onClick={() => onPick(u.i, u.field)}>
              {picking?.i === u.i && picking.field === u.field ? `Click the map where “${u.text}” is…` : `Pick “${u.text}” on the map`}
            </button>
          ))}
        </div>
      )}
      <div className="fx-confirm-foot">
        <span className="fx-sub">Saved to each location's history. It doesn't close the location.</span>
        <button className="fx-btn" onClick={onEdit}>Edit</button>
        <button className="fx-btn primary" onClick={onConfirm} disabled={busy || !p.actions.length}><Icon name="check" size={14} />{busy ? "Saving…" : "Confirm"}</button>
      </div>
    </div>
  );
}

export function FollowUp({ rec, onShow, onPrefill, onClose }: { rec: NextRec; onShow: () => void; onPrefill: () => void; onClose: () => void }) {
  return (
    <div className={`fx-followup fx-glass k-${rec.kind}`} role="status">
      <span className="fx-followup-ico"><Icon name={rec.kind === "more" ? "alert" : "sparkle"} size={15} /></span>
      <div className="fx-followup-main">
        <div className="fx-eyebrow">{rec.kind === "more" ? "People likely remain" : rec.kind === "next" ? "Next area with no help" : "Logged"}</div>
        <p>{rec.text}</p>
        {rec.basis && <p className="fx-caveat" title={rec.basis}>{rec.basis}</p>}
        <div className="fx-followup-actions">
          {rec.target && <button className="fx-btn" onClick={onShow}><Icon name="found" size={13} /> Show on map</button>}
          {rec.prefill && <button className="fx-btn primary" onClick={onPrefill}><Icon name="send" size={13} /> Log another team</button>}
        </div>
      </div>
      <button className="fx-icon-btn" onClick={onClose} aria-label="Dismiss"><Icon name="x" size={14} /></button>
    </div>
  );
}

export function ActionsPanel({ view, focus, onFocus, onUndo, onClose, onNext }: {
  view: ActionsView | null; focus: string | null; onFocus: (key: string, lon: number, lat: number) => void; onUndo: (id: string) => void; onClose: () => void; onNext: () => void;
}) {
  const locs = view?.locations ?? [];
  const unplaced = (view?.items ?? []).filter((a) => !a.place && !a.dest);
  return (
    <div className="fx-radio fx-actions fx-glass" role="dialog" aria-label="Actions on the ground">
      <header className="fx-radio-head">
        <div>
          <div className="fx-radio-title"><Icon name="check" size={16} /> Actions on the ground <span className="fx-count big">{view?.items.length ?? 0}</span></div>
          <div className="fx-sub">What analysts logged, by location. An action never closes a place; it tells the next recommendation what's there.</div>
        </div>
        <button className="fx-icon-btn" onClick={onClose} aria-label="Close actions"><Icon name="x" size={16} /></button>
      </header>
      {view?.next && view.next.kind !== "idle" && (
        <button className="fx-next" onClick={onNext}><Icon name="sparkle" size={13} /><span>{view.next.text}</span></button>
      )}
      <ul className="fx-locs">
        {!locs.length && <li className="fx-sub" style={{ padding: "12px 14px" }}>Nothing logged yet. Type what happened in the box below, e.g. “Sent QRT-2 to Balkhu, 40 people moved to Kalimati open space”.</li>}
        {locs.map((l) => (
          <li key={l.key} className={focus === l.key ? "on" : ""}>
            <button className="fx-loc-head" onClick={() => onFocus(l.key, l.lon, l.lat)}>
              <span className="fx-loc-pin"><Icon name="check" size={12} /></span>
              <span className="fx-st-main"><b>{l.name}</b><span>{locationLabel(l)}</span></span>
            </button>
            <ol className="fx-loc-lines">
              {l.lines.map((x) => (
                <li key={`${x.id}${x.role}`}>
                  <span className="fx-mono">{hhmm(x.at)}</span>
                  <span>{x.role === "received" ? `Received: ${x.summary}` : x.summary}</span>
                  {x.role === "here" && <button className="fx-undo" onClick={() => onUndo(x.id)} aria-label={`Undo: ${x.summary}`} title="Undo"><Icon name="x" size={11} /></button>}
                </li>
              ))}
            </ol>
          </li>
        ))}
        {unplaced.length > 0 && (
          <li>
            <div className="fx-loc-head static"><span className="fx-loc-pin off"><Icon name="alert" size={12} /></span><span className="fx-st-main"><b>Not on the map</b><span>Place name wasn't found and no spot was picked</span></span></div>
            <ol className="fx-loc-lines">
              {unplaced.map((a) => (
                <li key={a.id}><span className="fx-mono">{hhmm(a.loggedAt)}</span><span>{a.summary}</span><button className="fx-undo" onClick={() => onUndo(a.id)} aria-label={`Undo: ${a.summary}`} title="Undo"><Icon name="x" size={11} /></button></li>
              ))}
            </ol>
          </li>
        )}
      </ul>
      <footer className="fx-radio-foot">Saved on this server (data/runtime/actions.json). People-remaining figures are estimates: census density × flooded ground, an upper bound.</footer>
    </div>
  );
}
