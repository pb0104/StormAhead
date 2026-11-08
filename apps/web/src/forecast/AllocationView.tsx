/**
 * Resource allocation: a full section of its own (opened from the top bar), not a tab in the report. Everything the resource
 * allocation agent decided: totals, what each affected area gets, the fleet, and where every number comes from.
 */
import { useState } from "react";
import { Icon } from "./Icon.tsx";
import type { AgentResult } from "./api.ts";

export type AreaAllocation = {
  id: string; place: string; lon: number; lat: number; people: number; households: number; by: "road" | "helicopter"; from: string;
  foodKgPerDay: number; waterLPerDay: number; shelterKits: number; qrtTeams: number;
  vehicles: { type: string; label: string; count: number; perDayEachLabel: string; perDayLabel: string; note: string }[];
  perDay: number; perDayLabel: string; perDayAfterLabel: string; kitsLabel: string;
  allocated: number; allocatedLabel: string; fullNeed: number; fullNeedLabel: string; daysFunded: number; pin: string | null;
};
type Totals = {
  allocatedLabel: string; fullNeedLabel: string; perDayLabel: string; perDayAfterLabel: string; kitsLabel: string; fundLabel: string; shortfallLabel: string;
  days: number | null; askBy: string | null; horizonDays: number; emergencyDays: number; people: number; households: number; qrtTeams: number; window: string;
};
type Fleet = { type: string; label: string; count: number; perDayEachLabel: string; perDayLabel: string }[];
type Assumption = { item: string; value: string; status: "real" | "anchored" | "standard" | "estimate"; source: string; url?: string };

const n = (x: number) => x.toLocaleString("en-US");
/** "NPR 2.00 crore (~US$149k)" → NPR over USD. */
export function Money({ label }: { label: string }) {
  const m = label.match(/^(.*?) \(~(.*)\)$/);
  return m ? <><span className="fx-npr">{m[1]}</span><span className="fx-usd">{m[2]}</span></> : <span className="fx-npr">{label}</span>;
}

export function allocationOf(r: AgentResult | undefined) {
  const areas = r?.map?.["areas"] as AreaAllocation[] | undefined, totals = r?.map?.["totals"] as Totals | undefined;
  return areas?.length && totals
    ? { areas, totals, fleet: (r!.map!["fleet"] as Fleet | undefined) ?? [], assumptions: (r!.map!["assumptions"] as Assumption[] | undefined) ?? [] }
    : null;
}

const STATUS: Record<Assumption["status"], string> = { real: "Real", anchored: "Anchored", standard: "Standard", estimate: "Estimate" };

export function AllocationView({ r, onClose, onShow, initialId }: { r: AgentResult; onClose: () => void; onShow: (a: AreaAllocation) => void; initialId?: string | null }) {
  const a = allocationOf(r);
  const [selId, setSelId] = useState<string | null>((initialId && a?.areas.some((x) => x.id === initialId) ? initialId : null) ?? a?.areas[0]?.id ?? null);
  if (!a) {
    return (
      <section className="fx-allocview fx-glass" aria-label="Resource allocation">
        <header className="fx-av-head"><h2>Resource allocation</h2><button className="fx-icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button></header>
        <p className="fx-muted" style={{ padding: "0 24px" }}>{r.headline}</p>
      </section>
    );
  }
  const { areas, totals: t, fleet, assumptions } = a;
  const sel = areas.find((x) => x.id === selId) ?? areas[0]!;
  const E = t.emergencyDays, H = t.horizonDays;
  return (
    <section className="fx-allocview fx-glass" aria-label="Resource allocation">
      <header className="fx-av-head">
        <div>
          <span className="fx-area-kicker"><Icon name="resources" size={14} /> Resource allocation agent · draft, needs approval</span>
          <h2>Relief allocation · Kathmandu valley</h2>
          <p className="fx-sub">{t.window} · ~{n(t.people)} people in {n(t.households)} households across {areas.length} affected areas · NPR and US$ at NPR 134 per dollar</p>
        </div>
        <button className="fx-av-close" onClick={onClose}><Icon name="x" size={16} /> Back to map</button>
      </header>

      <div className="fx-av-scroll">
        <div className="fx-av-sum">
          <div><span>Allocated now</span><b><Money label={t.allocatedLabel} /></b><small>the emergency fund ({t.fundLabel.split(" (")[0]})</small></div>
          <div><span>Full need, {H} days</span><b><Money label={t.fullNeedLabel} /></b><small>shortfall {t.shortfallLabel}</small></div>
          <div><span>Per day, days 1–{E} (water up)</span><b><Money label={t.perDayLabel} /></b><small>basic needs, vehicles, {t.qrtTeams} QRT teams</small></div>
          <div><span>Per day, days {E + 1}–{H}</span><b><Money label={t.perDayAfterLabel} /></b><small>basic needs only, after {t.kitsLabel.split(" (")[0]} of shelter kits on day 1</small></div>
          <div className={t.days !== null ? "warn" : ""}><span>More national / FEMA-level aid needed in</span><b>{t.days !== null ? `${t.days} day${t.days === 1 ? "" : "s"}` : `Not within ${H} days`}</b><small>{t.askBy ? `request from NDRRMA by ${t.askBy}` : "the fund covers the whole period"}</small></div>
        </div>

        <div className="fx-av-main">
          <div className="fx-av-list">
            <h3>Affected areas</h3>
            <table className="fx-av-table">
              <thead><tr><th>Area</th><th>People</th><th>Allocated</th><th>Per day, days 1–{E}</th><th>Supplied by</th></tr></thead>
              <tbody>
                {areas.map((x) => (
                  <tr key={x.id} className={x.id === sel.id ? "sel" : ""} onClick={() => setSelId(x.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setSelId(x.id); }}>
                    <td><b>{x.place}</b></td>
                    <td>{n(x.people)}<small>{n(x.households)} households</small></td>
                    <td><Money label={x.allocatedLabel} /></td>
                    <td><Money label={x.perDayLabel} /></td>
                    <td>{x.by === "helicopter" ? <span className="fx-spend-tag">Helicopter</span> : "Road"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <aside className="fx-av-detail" aria-label={`Allocation for ${sel.place}`}>
            <div className="fx-av-detail-head">
              <div>
                <h3>{sel.place}</h3>
                <p className="fx-sub">~{n(sel.people)} people · {n(sel.households)} households · supplied from {sel.from}</p>
              </div>
              <button className="fx-av-show" onClick={() => onShow(sel)}><Icon name="layers" size={14} /> Show on map</button>
            </div>
            <div className="fx-av-tiles">
              <div><span>Allocated ({sel.daysFunded} day{sel.daysFunded === 1 ? "" : "s"} funded)</span><b><Money label={sel.allocatedLabel} /></b></div>
              <div><span>Full need, {H} days</span><b><Money label={sel.fullNeedLabel} /></b></div>
              <div><span>Per day, days 1–{E}</span><b><Money label={sel.perDayLabel} /></b></div>
              <div><span>Per day, days {E + 1}–{H}</span><b><Money label={sel.perDayAfterLabel} /></b></div>
            </div>
            <h4>Supplies</h4>
            <table className="fx-area-table">
              <tbody>
                <tr><td>Shelter kits (2 tarpaulins, 2 blankets, 2 mattresses), day 1</td><td>{n(sel.shelterKits)}<small><Money label={sel.kitsLabel} /></small></td></tr>
                <tr><td>Food rations (2,100 kcal), per day</td><td>{n(sel.people)}<small>~{n(sel.foodKgPerDay)} kg</small></td></tr>
                <tr><td>Safe water (15 L each), per day</td><td>{n(sel.waterLPerDay)} L</td></tr>
                <tr><td>QRT teams, days 1–{E}</td><td>{sel.qrtTeams}</td></tr>
              </tbody>
            </table>
            <h4>Vehicles, each day of days 1–{E}</h4>
            <ul className="fx-veh">
              {sel.vehicles.map((v) => (
                <li key={v.type}>
                  <span className="fx-veh-main"><b>{v.count} ×</b> {v.label}<small>{v.note}</small></span>
                  <span className="fx-veh-cost"><Money label={v.perDayEachLabel} /><small>each / day</small></span>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        {fleet.length > 0 && (
          <section className="fx-av-block">
            <h3>Whole fleet, each day of days 1–{E}</h3>
            <table className="fx-av-table compact">
              <thead><tr><th>Vehicle</th><th>Number</th><th>Each per day</th><th>Total per day</th></tr></thead>
              <tbody>{fleet.map((f) => <tr key={f.type}><td>{f.label}</td><td>{f.count}</td><td><Money label={f.perDayEachLabel} /></td><td><Money label={f.perDayLabel} /></td></tr>)}</tbody>
            </table>
          </section>
        )}

        {assumptions.length > 0 && (
          <section className="fx-av-block">
            <h3>Where the numbers come from</h3>
            <table className="fx-av-table compact fx-av-src">
              <thead><tr><th>Input</th><th>Value</th><th>Status</th><th>Source</th></tr></thead>
              <tbody>
                {assumptions.map((s) => (
                  <tr key={s.item}>
                    <td>{s.item}</td><td>{s.value}</td>
                    <td><span className={`fx-st st-${s.status}`}>{STATUS[s.status]}</span></td>
                    <td>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.source} ↗</a> : s.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="fx-area-note">Real: a published figure used as is. Anchored: derived from a published figure. Standard: an international minimum. Estimate: computed from real data. Estimate: a planning figure pending a published source.</p>
          </section>
        )}
      </div>
    </section>
  );
}
