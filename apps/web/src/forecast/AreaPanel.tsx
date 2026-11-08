/** Area card: click a spot in the valley to see its ward, the 2021 census, people on flood-risk ground and the relief it needs. */
import { Icon } from "./Icon.tsx";
import { Money } from "./AllocationView.tsx";

export type AreaInfo =
  | { found: false; lon: number; lat: number; message: string }
  | {
      found: true; lon: number; lat: number;
      ward: { name: string; number: string; municipality: string; areaKm2: number; rings: [number, number][][] };
      census: { municipality: string; population: number; households: number; under5: number; over65: number; wards: number | null; wardEstimate: number | null; source: string } | null;
      exposure: { people: number; floodedKm2: number; basis: string };
      relief: {
        people: number; households: number; shareUsed: number; perDay: number; perDayLabel: string; perDayAfterLabel: string; emergencyDays: number; horizonDays: number; fullNeedLabel: string;
        breakdown: { item: string; npr: number; label: string }[];
        vehicles: { type: string; label: string; count: number; perDayEachLabel: string; perDayLabel: string; note: string }[];
        kits: number; kitsLabel: string; allocated: number; allocatedLabel: string; days: number; by: "road" | "helicopter"; from: string;
      } | null;
      plan: string; mocked: string;
      nearest: { place: string; lon: number; lat: number; people: number; allocatedLabel: string; perDayLabel: string; km: number } | null;
    };

export async function fetchArea(at: [number, number]): Promise<AreaInfo> {
  const r = await fetch(`/api/forecast/area?lon=${at[0]}&lat=${at[1]}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const n = (x: number) => x.toLocaleString("en-US");

export function AreaPanel({ area, loading, error, onClose }: { area: AreaInfo | null; loading: boolean; error: string | null; onClose: () => void }) {
  return (
    <aside className="fx-area fx-glass" aria-label="Area details" aria-busy={loading}>
      <header className="fx-area-head">
        <div>
          <span className="fx-area-kicker"><Icon name="layers" size={13} /> Area</span>
          <h3>{area?.found ? `${area.ward.municipality} ward ${area.ward.number}` : loading ? "Looking up this spot…" : "Outside the valley"}</h3>
          {area?.found && <p className="fx-sub">{area.ward.areaKm2} km² · OpenStreetMap ward boundary</p>}
        </div>
        <button className="fx-icon-btn" onClick={onClose} aria-label="Close area details"><Icon name="x" size={16} /></button>
      </header>
      <div className="fx-area-body">
        {error && <p className="fx-err">{error}</p>}
        {area && !area.found && <p className="fx-muted">{area.message}</p>}
        {area?.found && (
          <>
            {area.relief && (
              <section>
                <h4>Relief allocated</h4>
                <dl className="fx-figures">
                  <div><dt>Allocated ({area.relief.days} day{area.relief.days === 1 ? "" : "s"} funded)</dt><dd><Money label={area.relief.allocatedLabel} /><small>full {area.relief.horizonDays}-day need <Money label={area.relief.fullNeedLabel} /></small></dd></div>
                  <div><dt>Per day, days 1–{area.relief.emergencyDays} (water up)</dt><dd><Money label={area.relief.perDayLabel} /><small>for ~{n(area.relief.people)} people ({Math.round(area.relief.shareUsed * 100)}% of those exposed)</small></dd></div>
                  <div><dt>Per day, days {area.relief.emergencyDays + 1}–{area.relief.horizonDays}</dt><dd><Money label={area.relief.perDayAfterLabel} /><small>basic needs only; plus <Money label={area.relief.kitsLabel} /> of shelter kits for {n(area.relief.households)} households on day 1</small></dd></div>
                </dl>
                <table className="fx-area-table">
                  <caption>Per day, days 1–{area.relief.emergencyDays}</caption>
                  <tbody>
                    {area.relief.breakdown.map((b) => <tr key={b.item}><td>{b.item}</td><td><Money label={b.label} /></td></tr>)}
                    <tr className="total"><td>Per day</td><td><Money label={area.relief.perDayLabel} /></td></tr>
                  </tbody>
                </table>
                {area.relief.vehicles.length > 0 && (
                  <>
                    <h5 className="fx-area-sub">Vehicles, each day of days 1–{area.relief.emergencyDays}</h5>
                    <ul className="fx-veh">
                      {area.relief.vehicles.map((v) => (
                        <li key={v.type}>
                          <span className="fx-veh-main"><b>{v.count} ×</b> {v.label}<small>{v.note}</small></span>
                          <span className="fx-veh-cost"><Money label={v.perDayEachLabel} /><small>each / day</small></span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="fx-area-src">{area.relief.by === "helicopter" ? "Cut off by road: supplied by helicopter from " : "Supplied by road from "}{area.relief.from}.</p>
              </section>
            )}
            {!area.relief && area.nearest && (
              <section>
                <h4>Relief allocated</h4>
                <p>Nothing allocated in this ward: the flood did not reach it. Nearest affected area: <b>{area.nearest.place}</b>, {area.nearest.km} km away, gets <b>{area.nearest.allocatedLabel}</b> for ~{n(area.nearest.people)} people ({area.nearest.perDayLabel} a day).</p>
              </section>
            )}
            <section>
              <h4>Population · Census 2021</h4>
              {area.census ? (
                <>
                  <dl className="fx-area-grid">
                    <div><dt>{area.census.municipality} (municipality)</dt><dd>{n(area.census.population)}</dd></div>
                    <div><dt>Households</dt><dd>{n(area.census.households)}</dd></div>
                    <div><dt>Under 5</dt><dd>{n(area.census.under5)}</dd></div>
                    <div><dt>65 and over</dt><dd>{n(area.census.over65)}</dd></div>
                  </dl>
                  {area.census.wardEstimate !== null && (
                    <p className="fx-area-est">This ward: <b>~{n(area.census.wardEstimate)}</b> <span>estimate, the municipality split evenly over its {area.census.wards} wards. No ward-level census is published in BIPAD.</span></p>
                  )}
                  <p className="fx-area-src">{area.census.source}</p>
                </>
              ) : <p className="fx-muted">No census record matched this ward.</p>}
            </section>
            <section>
              <h4>Flood exposure</h4>
              {area.exposure.people > 0
                ? <p><b>~{n(area.exposure.people)}</b> people live on the {area.exposure.floodedKm2} km² of this ward the 2024 flood covered.</p>
                : <p className="fx-muted">The 2024 flood did not reach this ward, so no relief is planned here.</p>}
              <p className="fx-area-src">{area.exposure.basis}</p>
            </section>
            <p className="fx-area-note">{area.plan} {area.mocked}</p>
          </>
        )}
      </div>
    </aside>
  );
}
