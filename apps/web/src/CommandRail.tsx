import type { Vis } from "./MapStage.tsx";

const INPUTS: { group: string; items: [string, string][] }[] = [
  { group: "Satellite", items: [["terrain", "Terrain"], ["roads", "Road network"], ["towers", "Cell towers"]] },
  { group: "Live feeds", items: [["weather", "Weather"], ["dams", "Dams"], ["social", "Social media"], ["radio", "Radio"]] },
  { group: "Assets", items: [["buildings", "Critical buildings"]] },
];
const OUTPUTS: [string, string][] = [
  ["closures", "Road closures"], ["landslides", "Landslides"], ["qrt", "QRT staging"], ["food", "Food"], ["shelter", "Shelter"], ["outages", "Outages"], ["alerts", "Public alerts"],
];
const STAGES: [number, string][] = [[1, "Now"], [2, "+6 h"], [3, "Peak +12 h"]];

export type RailProps = {
  open: boolean; setOpen: (b: boolean) => void; vis: Vis; toggle: (k: string) => void; stage: number; setStage: (n: number) => void;
  ran: boolean; busy: boolean; run: () => void; legendOpen: boolean; setLegendOpen: (b: boolean) => void; actionsDone: number; openDetails: () => void;
};

export function CommandRail(p: RailProps) {
  return (
    <>
      <aside className={`rail ${p.open ? "open" : ""}`} aria-label="Command rail">
        <div className="rail-top">
          <div className="brand"><span className="b1">Cascade</span><span className="b2">IQ</span></div>
          <button className="icon rail-close" onClick={() => p.setOpen(false)} aria-label="Close command rail">×</button>
        </div>
        <p className="tagline">Authority console. Where roads close, where to send response. Kathmandu valley, <b>demo data</b>.</p>

        <section>
          <label className="lbl" htmlFor="scn">Scenario</label>
          <select id="scn" defaultValue="a"><option value="a">Heavy rain and dam release, 27–28 Sep (demo)</option></select>
          <div className="seg" role="group" aria-label="Time">
            {STAGES.map(([n, l]) => <button key={n} aria-pressed={p.stage === n} onClick={() => p.setStage(n)}>{l}</button>)}
          </div>
        </section>

        <button className="cta" onClick={p.run} disabled={p.busy}>{p.busy ? "Assessing…" : p.ran ? "Refresh picture" : "Run cascade assessment"}</button>

        <section>
          <h2 className="lbl">Inputs</h2>
          {INPUTS.map((g) => (
            <div className="grp" key={g.group}>
              <span className="grp-n">{g.group}</span>
              <div className="chips">{g.items.map(([k, l]) => <button key={k} className="chip" aria-pressed={!!p.vis[k]} onClick={() => p.toggle(k)}>{l}</button>)}</div>
            </div>
          ))}
        </section>

        <section>
          <h2 className="lbl">Outputs</h2>
          <div className="chips">{OUTPUTS.map(([k, l]) => <button key={k} className="chip out" aria-pressed={!!p.vis[k]} onClick={() => p.toggle(k)}>{l}</button>)}</div>
        </section>

        <section className="legend">
          <button className="link" onClick={() => p.setLegendOpen(!p.legendOpen)} aria-expanded={p.legendOpen}>Legend {p.legendOpen ? "▴" : "▾"}</button>
          <ul>
            <li><i className="sw line" style={{ background: "#FF4A3D" }} />Closed road</li>
            <li><i className="sw line dash" style={{ borderColor: "#FFB020" }} />Cut-off road pocket</li>
            <li><i className="sw fill" style={{ background: "#FF7A1A55", borderColor: "#FF7A1A" }} />Landslide zone</li>
            <li><i className="sw fill" style={{ background: "#FFD23F33", borderColor: "#FFD23F" }} />Grid outage</li>
            {p.legendOpen && (
              <>
                <li><i className="sw fill" style={{ background: "#3DD6E022", borderColor: "#3DD6E0" }} />Public alert zone</li>
                <li><i className="sw dot" style={{ background: "#fff", borderColor: "#46D68C" }} />Hospital, access ok</li>
                <li><i className="sw dot" style={{ background: "#fff", borderColor: "#FFB020" }} />Hospital, degraded</li>
                <li><i className="sw dot" style={{ background: "#fff", borderColor: "#FF4A3D" }} />Hospital, access lost</li>
                <li><i className="sw dot sm" style={{ background: "#59E0D0" }} />Cell tower up</li>
                <li><i className="sw dot sm" style={{ background: "#FF8E7A" }} />Cell tower down</li>
                <li><i className="sw dot" style={{ background: "#7CC4FF" }} />Dam gauge</li>
                <li><i className="sw dot sm" style={{ background: "#9BC2D6" }} />Social post · <i className="sw dot sm" style={{ background: "#B8E0C4" }} />Radio call</li>
                <li><i className="sw dot" style={{ background: "#93C5FD" }} />QRT · <i className="sw dot" style={{ background: "#86EFAC" }} />Shelter · <i className="sw dot" style={{ background: "#FDE68A" }} />Food</li>
                <li><i className="sw fill" style={{ background: "#2B7BFF47", borderColor: "#6FB0FF" }} />Low ground · <i className="sw fill" style={{ background: "#4DA3FF30", borderColor: "#4DA3FF" }} />Rain</li>
              </>
            )}
          </ul>
        </section>

        <footer className="rail-foot">
          <span>{p.actionsDone} simulated action{p.actionsDone === 1 ? "" : "s"}</span>
          <button className="link" onClick={p.openDetails}>Details</button>
        </footer>
      </aside>
      <button className="rail-toggle" onClick={() => p.setOpen(true)} aria-label="Open command rail">Layers</button>
    </>
  );
}
