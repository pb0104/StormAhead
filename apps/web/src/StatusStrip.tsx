export type StripItem = { key: string; label: string; value: number | null };

export function StatusStrip({ items, focus, setFocus, openDetails, view3d, setView3d }: { items: StripItem[]; focus: string | null; setFocus: (k: string | null) => void; openDetails: () => void; view3d: boolean; setView3d: (b: boolean) => void }) {
  return (
    <div className="strip" role="toolbar" aria-label="Status filters">
      {items.map((i) => (
        <button key={i.key} className={`stat ${focus === i.key ? "on" : ""} ${i.key}`} aria-pressed={focus === i.key} onClick={() => setFocus(focus === i.key ? null : i.key)}>
          <b key={String(i.value)}>{i.value === null ? "–" : i.value}</b><span>{i.label}</span>
        </button>
      ))}
      <span className="spacer" />
      <div className="seg2" role="group" aria-label="Map view">
        <button aria-pressed={!view3d} onClick={() => setView3d(false)}>2D</button>
        <button aria-pressed={view3d} onClick={() => setView3d(true)}>3D</button>
      </div>
      <span className="demo-tag">DEMO DATA</span>
      <button className="link" onClick={openDetails}>Details</button>
    </div>
  );
}
