import { GLYPH, type BuildingKind } from "./icons.ts";

/** The same building shape the map uses, as inline SVG for the legend and drawer. */
export function Glyph({ kind, ring, badge = false, size = 20 }: { kind: BuildingKind; ring: string; badge?: boolean; size?: number }) {
  const g = GLYPH[kind];
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={g.label}>
      <path d={g.body} fill={g.fill} stroke={ring} strokeWidth="2.4" strokeLinejoin="round" />
      <path d={g.mark} fill={g.markStroke ? "none" : "#0B1318"} stroke={g.markStroke ? "#0B1318" : "none"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {badge && <g><circle cx="19" cy="5" r="4.6" fill={ring} stroke="#0B1318" strokeWidth="1" /><path d="M19 3v2.6M19 6.8v.1" stroke="#0B1318" strokeWidth="1.4" strokeLinecap="round" /></g>}
    </svg>
  );
}
