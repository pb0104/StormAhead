import { useState } from "react";
import { actions, KIND_LABEL, reasons, type Action } from "./mock/advice.ts";
import type { Entity } from "./mock/demo.ts";
import { Glyph } from "./Glyph.tsx";
import { RING, type BuildingKind } from "./icons.ts";

const BUILDINGS = new Set(["hospital", "school", "shelter", "food", "qrt", "airport", "army"]);
const ringFor = (e: Entity) => (e.kind === "hospital" || e.kind === "airport" || e.kind === "army" ? (RING as Record<string, string>)[String(e.props.access)] : e.kind === "school" ? (RING as Record<string, string>)[String(e.props.risk)] : RING.base) ?? RING.none;

export type Done = Record<string, "assigned" | "issued">;
const VERB: Record<Action["kind"], string> = { qrt: "Assign QRT", food: "Stage food", shelter: "Open shelter", grid: "Assign crew", alert: "Issue alert", road: "Stage", air: "Reserve", army: "Request" };

export function ContextDrawer({ e, done, setDone, onClose, onHover, onFly, onPhoto }: { onHover: (id: string | null) => void; onFly: (() => void) | null; onPhoto: () => void; e: Entity | null; done: Done; setDone: (f: (d: Done) => Done) => void; onClose: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const acts = e ? actions(e) : [];
  const why = e ? reasons(e) : [];
  const set = (id: string, v: "assigned" | "issued" | null) => setDone((d) => { const n = { ...d }; if (v) n[id] = v; else delete n[id]; return n; });
  return (
    <aside className={`drawer ${e ? "open" : ""}`} aria-hidden={!e} aria-label="Selected item">
      {e && (
        <>
          <header className="d-head">
            {BUILDINGS.has(e.kind) && <span className="d-glyph"><Glyph kind={e.kind as BuildingKind} ring={ringFor(e)} badge={e.props.risk === "risk" || e.props.risk === "high" || e.props.access === "degraded" || e.props.access === "lost"} size={40} /></span>}
            <div style={{ flex: 1 }}>
              <span className="d-kind">{KIND_LABEL[e.kind]} · {e.id}</span>
              <h2>{e.name}</h2>
            </div>
            <button className="icon" onClick={onClose} aria-label="Close">×</button>
          </header>
          <div className="d-tools">{onFly && <button className="ghost" onClick={onFly}>Fly through in 3D</button>}<button className="ghost" onClick={onPhoto}>View in photoreal</button></div>
          <div className="d-body">
            <section>
              <h3>What failed, and why</h3>
              <ul className="why">{why.map((r) => <li key={r.input}><b>{r.input}</b><span>{r.text}</span></li>)}</ul>
            </section>
            {acts.length > 0 && (
              <section>
                <h3>Recommended response</h3>
                <div className="acts">
                  {acts.map((a) => {
                    const st = done[a.id];
                    return (
                      <div key={a.id} className={`act ${st ? "on" : ""}`} onMouseEnter={() => onHover(a.id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(a.id)} onBlur={() => onHover(null)}>
                        <div className="act-t"><span className={`dot ${a.kind}`} />{a.title}</div>
                        <p>{a.detail}</p>
                        {a.kind === "alert" && preview === a.id && (
                          <div className="alert-prev"><b>English</b><p>{a.alertEn}</p><b>नेपाली</b><p lang="ne">{a.alertNe}</p></div>
                        )}
                        <div className="act-b">
                          {a.kind === "alert" ? (
                            <>
                              <button className="ghost" onClick={() => setPreview(preview === a.id ? null : a.id)}>{preview === a.id ? "Hide preview" : "Preview"}</button>
                              {st ? <button className="ghost" onClick={() => set(a.id, null)}>Withdraw</button> : <button className="go" onClick={() => { setPreview(a.id); set(a.id, "issued"); }}>Issue (simulated)</button>}
                            </>
                          ) : st ? <button className="ghost" onClick={() => set(a.id, null)}>Undo</button> : <button className="go" onClick={() => set(a.id, "assigned")}>{VERB[a.kind]} (simulated)</button>}
                          {st && <span className="stamp">{st === "issued" ? "Issued, simulated" : "Assigned, simulated"}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            <p className="d-foot">Demo only. Nothing is sent and nobody is dispatched.</p>
          </div>
        </>
      )}
    </aside>
  );
}
