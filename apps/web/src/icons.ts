/** One shape per building type, drawn the same way on the map (canvas) and in the UI (inline SVG). 24 x 24 box. */
export type BuildingKind = "hospital" | "school" | "shelter" | "food" | "qrt" | "airport" | "army";

export const GLYPH: Record<BuildingKind, { body: string; mark: string; markStroke?: boolean; fill: string; label: string }> = {
  hospital: { body: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", mark: "M10.5 6.5h3v4h4v3h-4v4h-3v-4h-4v-3h4z", fill: "#FFFFFF", label: "Hospital" },
  school: { body: "M12 2.5 2.5 9v12.5h19V9z", mark: "M9.5 21.5v-6.5h5v6.5M12 2.5V.5M12 .8h3.6v2", markStroke: true, fill: "#FFFFFF", label: "School" },
  shelter: { body: "M12 3 2.5 20.5h19z", mark: "M12 20.5 9.5 14.5h5z", fill: "#86EFAC", label: "Shelter" },
  food: { body: "M3.5 6.5h17v14h-17z", mark: "M3.5 11h17M3.5 15.5h17", markStroke: true, fill: "#FDE68A", label: "Food depot" },
  airport: { body: "M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-1.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-4.5z", mark: "M11.5 9v9", markStroke: true, fill: "#A5D8FF", label: "Airport or helipad" },
  army: { body: "M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7.3L12 17.8 5.7 21.5l1.7-7.3L2 9.5l7.1-.6z", mark: "M8.7 13.2 12 10.8l3.3 2.4", markStroke: true, fill: "#C9D58B", label: "Army base" },
  qrt: { body: "M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9z", mark: "M7.8 13.5 12 9.3l4.2 4.2", markStroke: true, fill: "#93C5FD", label: "QRT staging" },
};

export const RING = { none: "#FFFFFF", ok: "#46D68C", degraded: "#FFB020", risk: "#FFB020", lost: "#FF4A3D", high: "#FF4A3D", base: "#0B1318" } as const;

/** RGBA pixels for a map icon. `ring` is the state colour, `badge` adds an exclamation mark for at-risk buildings. */
export function drawIcon(kind: BuildingKind, ring: string, badge: boolean): { width: number; height: number; data: Uint8ClampedArray } {
  const S = 64, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const k = (S - 8) / 24, glyph = GLYPH[kind];
  g.translate(4, 6); g.scale(k, k * 0.98);
  const body = new Path2D(glyph.body);
  g.lineJoin = "round"; g.lineCap = "round";
  g.lineWidth = 3.4; g.strokeStyle = ring; g.stroke(body);
  g.fillStyle = glyph.fill; g.fill(body);
  g.lineWidth = 1.7; g.strokeStyle = "#0B1318"; g.fillStyle = "#0B1318";
  const mark = new Path2D(glyph.mark);
  if (glyph.markStroke) g.stroke(mark); else g.fill(mark);
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (badge) {
    g.beginPath(); g.arc(S - 14, 14, 11, 0, Math.PI * 2); g.fillStyle = ring; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = "#0B1318"; g.stroke();
    g.fillStyle = "#0B1318"; g.font = "700 17px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("!", S - 14, 15);
  }
  return { width: S, height: S, data: g.getImageData(0, 0, S, S).data };
}

/** Data URL of a map icon, for Cesium billboards. */
export function iconDataUrl(kind: BuildingKind, ring: string, badge: boolean): string {
  const px = drawIcon(kind, ring, badge), c = document.createElement("canvas");
  c.width = px.width; c.height = px.height;
  c.getContext("2d")!.putImageData(new ImageData(px.data as Uint8ClampedArray<ArrayBuffer>, px.width, px.height), 0, 0);
  return c.toDataURL("image/png");
}
