export type StripItem = { key: string; label: string; value: number | null };

export function StatusStrip({ items, focus, setFocus, openDetails, mode, setMode }: { items: StripItem[]; focus: string | null; setFocus: (k: string | null) => void; openDetails: () => void; mode: "2d" | "3d"; setMode: (m: "2d" | "3d") => void }) {
  return (
    <div className="strip" role="toolbar" aria-label="Status filters">
      <div className="stats">
      {items.map((i) => (
        <button key={i.key} className={`stat ${focus === i.key ? "on" : ""} ${i.key}`} aria-pressed={focus === i.key} onClick={() => setFocus(focus === i.key ? null : i.key)}>
          <b key={String(i.value)}>{i.value === null ? "–" : i.value}</b><span>{i.label}</span>
        </button>
      ))}
      </div>
      <div className="seg2" role="group" aria-label="Map view">
        <button aria-pressed={mode === "2d"} onClick={() => setMode("2d")}>2D</button>
        <button aria-pressed={mode === "3d"} onClick={() => setMode("3d")}>3D</button>
      </div>
      <span className="demo-tag">DEMO DATA</span>
      <button className="link" onClick={openDetails}>Details</button>
    </div>
  );
}
