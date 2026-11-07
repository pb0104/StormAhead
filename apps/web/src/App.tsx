import { useEffect, useMemo, useRef, useState } from "react";
import { MapStage, type Vis } from "./MapStage.tsx";
import { CommandRail } from "./CommandRail.tsx";
import { StatusStrip, type StripItem } from "./StatusStrip.tsx";
import { ContextDrawer, type Done } from "./ContextDrawer.tsx";
import { DetailsDialog } from "./DetailsDialog.tsx";
import { actions } from "./mock/advice.ts";
import { OF, type Entity } from "./mock/demo.ts";

/**
 * Authority ops console, DEMO build. Every layer except OSM road geometry and the satellite base is mock.
 * The research hindcast view (HindcastView.tsx) is still in the repo but is no longer the primary screen.
 */
const DEFAULT_VIS: Vis = {
  terrain: true, roads: true, towers: false, weather: true, dams: false, social: false, radio: false, buildings: true,
  closures: true, landslides: true, qrt: false, food: false, shelter: false, outages: true, alerts: false,
};
const TOTAL = OF("closure").length;

export function App() {
  const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches;
  const [vis, setVis] = useState<Vis>(DEFAULT_VIS);
  const [stage, setStage] = useState(3);
  const [ran, setRan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revealN, setRevealN] = useState(0);
  const [pockets, setPockets] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [done, setDone] = useState<Done>({});
  const [railOpen, setRailOpen] = useState(!narrow);
  const [legendOpen, setLegendOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [view3d, setView3d] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearInterval(timer.current), []);

  const run = () => {
    if (busy) return;
    window.clearInterval(timer.current);
    setBusy(true); setRan(true); setSelected(null); setPockets(false); setRevealN(0);
    if (narrow) setRailOpen(false);
    let n = 0;
    timer.current = window.setInterval(() => {
      n += 1; setRevealN(n);
      if (n >= TOTAL) { window.clearInterval(timer.current); window.setTimeout(() => { setPockets(true); setBusy(false); }, 450); }
    }, 170);
  };

  const pick = (k: string | null) => { setFocus(k); if (k && !ran && !busy) run(); };
  const toggle = (k: string) => setVis((v) => ({ ...v, [k]: !v[k] }));
  const select = (e: Entity | null) => { setSelected(e); if (e && narrow) setRailOpen(false); };
  const recommended = useMemo(() => (selected ? actions(selected).flatMap((a) => (a.target ? [a.target] : [])) : []), [selected]);

  const closed = OF("closure").filter((c) => (c.stage ?? 0) <= stage).length;
  const strip: StripItem[] = [
    { key: "closures", label: "closed roads", value: ran ? (revealN >= TOTAL ? closed : Math.min(revealN, closed)) : null },
    { key: "pockets", label: "cut-off pockets", value: ran && pockets ? OF("pocket").length : null },
    { key: "landslides", label: "landslide zones", value: ran ? OF("landslide").length : null },
    { key: "hospitals", label: "hospitals at risk", value: ran ? OF("hospital").filter((h) => h.props.access !== "ok").length : null },
    { key: "outages", label: "grid outages", value: ran ? OF("outage").length : null },
  ];
  const hint = ran && !busy && !selected;

  return (
    <div className="shell">
      <MapStage ran={ran} revealN={revealN} showPockets={pockets} stage={stage} vis={vis} focus={focus} selected={selected} recommended={recommended} onSelect={select} compact={narrow} view3d={view3d} />
      <StatusStrip items={strip} focus={focus} setFocus={pick} openDetails={() => setDetails(true)} view3d={view3d} setView3d={setView3d} />
      <CommandRail open={railOpen} setOpen={setRailOpen} vis={vis} toggle={toggle} stage={stage} setStage={setStage} ran={ran} busy={busy} run={run}
        legendOpen={legendOpen} setLegendOpen={setLegendOpen} actionsDone={Object.keys(done).length} openDetails={() => setDetails(true)} />
      {hint && <div className="hint" role="status">Select a closed road to see where to send response.</div>}
      <ContextDrawer key={selected?.id ?? "none"} e={selected} done={done} setDone={setDone} onClose={() => setSelected(null)} />
      <DetailsDialog open={details} onClose={() => setDetails(false)} done={done} />
    </div>
  );
}
