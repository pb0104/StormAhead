import type { Vis } from "./MapStage.tsx";
import { Glyph } from "./Glyph.tsx";
import type { TerrainResult as Terrain, Weather } from "../../../packages/ports/index.ts";
import { OBSERVED_IN, WEATHER, whenText } from "./real/ops.ts";

const INPUTS: { group: string; items: [string, string][] }[] = [
  { group: "Satellite", items: [["terrain", "Terrain"], ["roads", "Road network"], ["towers", "Cell towers"]] },
  { group: "Live feeds", items: [["weather", "Weather"], ["atmosphere", "Atmosphere"], ["dams", "River gauges"], ["social", "Social media"]] },
  { group: "Assets", items: [["buildings", "Hospitals"], ["schools", "Schools"], ["airports", "Airports"], ["helipads", "Helipads"], ["army", "Army sites"]] },
];
const OUTPUTS: [string, string][] = [
  ["closures", "Road closures"], ["flood", "Flooding"], ["runoff", "Runoff flow"], ["shelterBuildings", "Shelter & evacuate"], ["landslides", "Landslides"], ["qrt", "Responder bases"], ["food", "Food"], ["shelter", "Shelter"], ["outages", "Outages"], ["alerts", "Official alerts"],
];
const STAGES: [number, string][] = [[1, "Now"], [2, "+6 h"], [3, "Peak +12 h"]];

export type RailProps = {
  open: boolean; setOpen: (b: boolean) => void; vis: Vis; toggle: (k: string) => void; stage: number; setStage: (n: number) => void;
  rain: number; setRain: (n: number) => void; weather: Weather; terrain: Terrain; wet: number; total: number; deepest: number; flowText: string;
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
        <p className="tagline">Authority console. Where roads close, where to send response. Kathmandu valley, 27–28 Sep 2024. Facilities, alerts, gauges and social posts are <b>real</b>; towers, outages, radio and food depots are <b>simulated</b>.</p>

        <section>
          <label className="lbl" htmlFor="scn">Scenario</label>
          <select id="scn" defaultValue="a"><option value="a">27–28 Sep 2024 floods (observed flood, real facilities)</option></select>
          <div className="seg" role="group" aria-label="Time">
            {STAGES.map(([n, l]) => <button key={n} aria-pressed={p.stage === n} onClick={() => p.setStage(n)}>{l}</button>)}
          </div>
        </section>

        <button className="cta" onClick={p.run} disabled={p.busy}>{p.busy ? "Assessing…" : p.ran ? "Refresh picture" : "Run cascade assessment"}</button>

        <section>
          <h2 className="lbl">Rain</h2>
          <div className="seg" role="group" aria-label="Rain presets">
            <button aria-pressed={p.rain === OBSERVED_IN} onClick={() => p.setRain(OBSERVED_IN)}>Observed</button>
            {[6, 10, 15].filter((n) => n !== OBSERVED_IN).map((n) => <button key={n} aria-pressed={p.rain === n} onClick={() => p.setRain(n)}>{n} in</button>)}
          </div>
          <input className="range" type="range" min={4} max={20} step={1} value={p.rain} onChange={(e) => p.setRain(+e.target.value)} aria-label="Rainfall in inches over 24 hours" />
          <p className="agent"><b>Weather agent</b> (real, Open-Meteo, ECMWF IFS 9 km): heaviest 24 h in the valley was <b>{WEATHER.max24hMm} mm</b>, ending {whenText(WEATHER.max24hEnd)}. Peak {WEATHER.peakMmH} mm/h at {whenText(WEATHER.peakAt)}. 27–28 Sep total {WEATHER.total2728Mm} mm (ERA5: {WEATHER.era5Total2728Mm} mm).</p>
          <p className="agent">{p.rain === OBSERVED_IN ? <>Depth model uses the observed <b>{p.weather.inches} in</b> ({Math.round(p.weather.mm)} mm).</> : <>What-if: <b>{p.weather.inches} in</b> ({Math.round(p.weather.mm)} mm) in 24 h, instead of the observed {OBSERVED_IN} in.</>}</p>
          <p className="agent"><b>Terrain agent</b> ({p.terrain.status === "ready" ? "real elevation" : p.terrain.status}): {p.terrain.note}</p>
          <div className="depthbar" aria-hidden="true"><i /></div>
          <div className="depthkey"><span>shallow</span><span>1.5 m</span><span>3 m+</span></div>
          <p className="agent">{p.flowText}</p>
          <p className="agent">{p.ran ? `${p.wet} of ${p.total} observed flood patches are wet now, deepest about ${p.deepest.toFixed(1)} m.` : "Run the assessment to see depth."}</p>
        </section>

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
            <li><i className="sw fill" style={{ background: "#FFFFFF33", borderColor: "#C8D4DC" }} />Cloud cover</li>
            <li><i className="sw line" style={{ background: "#9BB0C0" }} />Pressure isobar · H / L</li>
            <li><i className="sw fill" style={{ background: "#2A78C880", borderColor: "#A8DCFF" }} />Flood water</li>
            <li><i className="sw fill" style={{ background: "#3E8FD3A0", borderColor: "#CDF0FF" }} />Pooled runoff, with flow streaks</li>
            <li><i className="sw line dash" style={{ borderColor: "#FFB020" }} />Cut-off road pocket</li>
            <li><i className="sw fill" style={{ background: "#FF7A1A55", borderColor: "#FF7A1A" }} />Landslide zone</li>
            <li><i className="sw fill" style={{ background: "#FFD23F33", borderColor: "#FFD23F" }} />Grid outage</li>
            <li><Glyph kind="school" ring="#FFB020" badge />School at risk</li>
            <li><i className="sw fill" style={{ background: "#FF4A3Dcc", borderColor: "#FF4A3D" }} />Building to evacuate <em className="real">real</em></li>
            {p.legendOpen && (
              <>
                <li><i className="sw fill" style={{ background: "#FFB020cc", borderColor: "#FFB020" }} />Building, shelter on upper floors <em className="real">real</em></li>
                <li><i className="sw fill" style={{ background: "#86EFACcc", borderColor: "#86EFAC" }} />Building usable as a refuge <em className="real">real</em></li>
                <li><i className="sw fill" style={{ background: "#9BA8B0cc", borderColor: "#9BA8B0" }} />Building, height not tagged — no judgement <em className="real">real</em></li>
                <li><Glyph kind="hospital" ring="#46D68C" />Hospital, access ok</li>
                <li><Glyph kind="hospital" ring="#FFB020" badge />Hospital, degraded</li>
                <li><Glyph kind="hospital" ring="#FF4A3D" badge />Hospital, access lost</li>
                <li><Glyph kind="school" ring="#46D68C" />School, no risk found</li>
                <li><Glyph kind="school" ring="#FFB020" badge />School at risk</li>
                <li><Glyph kind="school" ring="#FF4A3D" badge />School, high risk</li>
                <li><Glyph kind="airport" ring="#46D68C" />Airport, access ok · <Glyph kind="airport" ring="#FFB020" badge />limited</li>
                <li><Glyph kind="helipad" ring="#46D68C" />Helipad, access ok · <Glyph kind="helipad" ring="#FFB020" badge />limited</li>
                <li><Glyph kind="army" ring="#46D68C" />Army base, access ok · <Glyph kind="army" ring="#FFB020" badge />limited</li>
                <li><i className="sw dot sm" style={{ background: "#59E0D0" }} />Cell tower up</li>
                <li><i className="sw dot sm" style={{ background: "#FF8E7A" }} />Cell tower down</li>
                <li><i className="sw dot" style={{ background: "#7CC4FF" }} />Dam</li>
                <li><Glyph kind="qrt" ring="#0B1318" />QRT · <Glyph kind="shelter" ring="#0B1318" />Shelter · <Glyph kind="food" ring="#0B1318" />Food</li>
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
