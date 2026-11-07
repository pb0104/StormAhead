import { useEffect, useRef } from "react";
import { maplibregl } from "./mapsetup.ts";
import satUrl from "./assets/valley.jpg?url";
import { affected } from "./affected.ts";
import type { AtmosphereSnapshot, Entity, Grid, SceneSnapshot } from "../../../packages/ports/index.ts";
import { drawIcon, RING, type BuildingKind } from "./icons.ts";
export type FlowField = { grid: Grid; gx: Float32Array; gy: Float32Array; acc: Float32Array };

export type Vis = Record<string, boolean>;
export type Rec = { id: string; kind: string; at: [number, number]; label: string; target?: string };
export const REC_COLOR: Record<string, string> = { qrt: "#93C5FD", food: "#FDE68A", shelter: "#86EFAC", grid: "#FFD23F", alert: "#3DD6E0", air: "#A5D8FF", army: "#C9D58B" };
const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };
export type MapProps = {
  scene: SceneSnapshot;
  ran: boolean; revealN: number; showPockets: boolean; stage: number; vis: Vis; focus: string | null;
  selected: Entity | null; recs: Rec[]; hover: string | null; buildings: unknown; buildingById: Map<string, Entity>; onSelect: (e: Entity | null) => void; compact: boolean; view3d: boolean; flood: unknown; flowUrl: string | null; field: FlowField | null; rainIn: number; flying: boolean; onFlyEnd: () => void;
  atmosphere?: AtmosphereSnapshot | null;
};

const WAVE_FRAMES = 8;
/** One frame of a seamless wave pattern: pale streaks that drift sideways as k advances. */
function waveFrame(k: number): { width: number; height: number; data: Uint8ClampedArray } {
  const S = 64, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d")!, ph = (k / WAVE_FRAMES) * Math.PI * 2;
  g.lineCap = "round";
  for (const [y0, a, alpha] of [[10, 3, 0.5], [32, 4, 0.42], [54, 3, 0.5]] as const) {
    g.beginPath();
    for (let x = 0; x <= S; x += 2) { const y = y0 + a * Math.sin((x / S) * Math.PI * 2 * 2 + ph); x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = `rgba(200,235,255,${alpha})`; g.lineWidth = 2.2; g.stroke();
  }
  return { width: S, height: S, data: g.getImageData(0, 0, S, S).data };
}
const RED = "#FF4A3D", AMBER = "#FFB020";
const HIT = ["bldg-fill", "bldg-3d", "pts-hospital", "pts-school", "pts-airport", "pts-helipad", "pts-army", "pts-tower", "pts-dam", "pts-shelter", "pts-food", "pts-qrt", "closures", "closures-muted", "pockets", "z-landslide-fill", "z-outage-fill", "z-alert-fill"];
const GROUP: Record<string, string[]> = {
  closures: ["closures-glow", "closures", "closures-minor", "closures-muted"], pockets: ["pockets", "pockets-minor"],
  landslides: ["z-landslide-fill", "z-landslide-line"], hospitals: ["pts-hospital"], schools: ["pts-school"], outages: ["z-outage-fill", "z-outage-line"],
};
const OPACITY_PROP: Record<string, string> = {
  "closures-glow": "line-opacity", closures: "line-opacity", "closures-minor": "line-opacity", "closures-muted": "line-opacity", pockets: "line-opacity", "pockets-minor": "line-opacity",
  "z-landslide-fill": "fill-opacity", "z-landslide-line": "line-opacity", "pts-hospital": "icon-opacity", "pts-school": "icon-opacity", "pts-airport": "icon-opacity", "pts-helipad": "icon-opacity", "pts-army": "icon-opacity", "z-outage-fill": "fill-opacity", "z-outage-line": "line-opacity",
};
const BASE_OPACITY: Record<string, number> = {
  "closures-glow": 0.45, closures: 1, "closures-minor": 0.8, "closures-muted": 0.4, pockets: 1, "pockets-minor": 0.7,
  "z-landslide-fill": 0.38, "z-landslide-line": 0.95, "pts-hospital": 1, "pts-school": 1, "z-outage-fill": 0.2, "z-outage-line": 0.9,
};

export function MapStage(p: MapProps) {
  const box = useRef<HTMLDivElement>(null), tip = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null), ready = useRef(false), props = useRef(p), markers = useRef<any[]>([]), raf = useRef(0), bar = useRef<HTMLElement | null>(null), floodRef = useRef<unknown>(null), bldgRef = useRef<unknown>(null), flowCv = useRef<HTMLCanvasElement | null>(null), runoffUrl = useRef<string | null>(null);
  props.current = p;

  useEffect(() => {
    if (!box.current) return;
    const scene = props.current.scene;
    const BBOX = scene.bbox;
    const GEO = scene.geo;
    const BY_ID = new Map(scene.entities.map((e) => [e.id, e]));
    const m = new maplibregl.Map({
      container: box.current, attributionControl: false, dragRotate: false, pitchWithRotate: true, maxPitch: 78,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#0A1217" } }],
      },
      bounds: [[BBOX[0], BBOX[1]], [BBOX[2], BBOX[3]]], fitBoundsOptions: { padding: { top: 64, bottom: 24, left: props.current.compact ? 16 : 310, right: 16 } },
      maxZoom: 18,
    });
    map.current = m;
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Real + simulated layers (see Details) · Rain: Open-Meteo (CC BY 4.0) · Facilities, alerts, gauges: BIPAD · Base: Esri World Imagery (Maxar), cached · Roads: © OpenStreetMap contributors" }), "bottom-right");
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    m.on("load", () => {
      const TL = { "line-opacity-transition": { duration: 600 } }, TF = { "fill-opacity-transition": { duration: 600 } };
      m.addSource("sat", { type: "image", url: satUrl, coordinates: [[BBOX[0], BBOX[3]], [BBOX[2], BBOX[3]], [BBOX[2], BBOX[1]], [BBOX[0], BBOX[1]]] });
      for (const [id, data] of Object.entries({ flood: GEO.flood, roads: GEO.roads, closures: GEO.closures, minor: GEO.minor, pockets: GEO.pockets, zones: GEO.zones, points: GEO.points, low: GEO.low, rain: GEO.rain }))
        m.addSource(id, { type: "geojson", data });
      const empty = { type: "FeatureCollection", features: [] };
      m.addSource("sel", { type: "geojson", data: empty });
      m.addSource("rec", { type: "geojson", data: empty });
      m.addSource("affected", { type: "geojson", data: empty });
      m.addSource("bldg", { type: "geojson", data: empty });
      m.addSource("dem", { type: "raster-dem", tiles: ["/api/tiles/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: "Terrain: Mapzen / AWS Terrain Tiles (proxied+cached)" });

      m.addLayer({ id: "sat", type: "raster", source: "sat", paint: { "raster-opacity": 0.9, "raster-saturation": -0.45, "raster-brightness-max": 0.95, "raster-contrast": 0.15 } });
      // Sharper imagery streamed as tiles (about 0.5 m near Kathmandu). The dimmed 10 m mosaic above stays as the offline fallback.
      m.addSource("esri", { type: "raster", tiles: ["/api/tiles/esri/{z}/{y}/{x}"], tileSize: 256, maxzoom: 18, attribution: "Imagery: Esri, Maxar, Earthstar Geographics (proxied+cached)" });
      m.addLayer({ id: "esri", type: "raster", source: "esri", paint: { "raster-opacity": 0.92, "raster-saturation": -0.35, "raster-brightness-max": 0.92, "raster-contrast": 0.12, "raster-fade-duration": 250 } });
      m.addLayer({ id: "hill", type: "hillshade", source: "dem", layout: { visibility: "none" }, paint: { "hillshade-exaggeration": 0.55, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#BFD2DA", "hillshade-accent-color": "#4A5B64" } });
      m.addSource("atm-clouds", { type: "geojson", data: EMPTY_FC });
      m.addSource("atm-isobars", { type: "geojson", data: EMPTY_FC });
      m.addSource("atm-centers", { type: "geojson", data: EMPTY_FC });
      m.addLayer({ id: "rain", type: "fill", source: "rain", paint: { "fill-color": "#4DA3FF", "fill-opacity": ["interpolate", ["linear"], ["get", "v"], 2, 0.1, 3, 0.18] } });
      m.addLayer({ id: "low", type: "fill", source: "low", paint: { "fill-color": "#2B7BFF", "fill-opacity": 0.28, "fill-outline-color": "#6FB0FF" } });
      // Flood water: the observed extent, tinted, with a rippling pattern that is advanced frame by frame.
      for (let k = 0; k < WAVE_FRAMES; k++) m.addImage(`wave-${k}`, waveFrame(k), { pixelRatio: 2 });
      m.addLayer({ id: "flood-fill", type: "fill", source: "flood", paint: { "fill-color": ["interpolate", ["linear"], ["get", "d"], 0, "#8CCBF5", 0.5, "#4A9BE6", 1.5, "#2368C4", 3, "#123C8A"], "fill-opacity": 0, "fill-opacity-transition": { duration: 1800 } } });
      m.addLayer({ id: "flood-waves", type: "fill", source: "flood", paint: { "fill-pattern": "wave-0", "fill-opacity": 0, "fill-opacity-transition": { duration: 1800 } } });
      m.addLayer({ id: "flood-edge", type: "line", source: "flood", paint: { "line-color": "#A8DCFF", "line-width": 1.1, "line-opacity": 0, "line-opacity-transition": { duration: 1800 } } });
      // Runoff: a depth raster from the flow agent, with animated streaks drawn on a canvas that follow the slope.
      const BLANK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
      const corners: [[number, number], [number, number], [number, number], [number, number]] = [[BBOX[0], BBOX[3]], [BBOX[2], BBOX[3]], [BBOX[2], BBOX[1]], [BBOX[0], BBOX[1]]];
      m.addSource("runoff", { type: "image", url: BLANK, coordinates: corners });
      m.addLayer({ id: "runoff-raster", type: "raster", source: "runoff", paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 1500 }, "raster-resampling": "linear", "raster-fade-duration": 0 } });
      m.addLayer({ id: "roads", type: "line", source: "roads", layout: { "line-cap": "round" }, paint: {
        "line-color": ["match", ["get", "c"], 0, "#E4ECF0", 1, "#D3DEE4", 2, "#A9BAC4", "#8497A2"],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, ["match", ["get", "c"], 0, 1.3, 1, 1.1, 0.6], 15, ["match", ["get", "c"], 0, 4, 1, 3.4, 2, 2.4, 1.6]],
        "line-opacity": 0.75 } });
      for (const k of ["landslide", "outage", "alert"]) {
        const col = k === "landslide" ? "#FF7A1A" : k === "outage" ? "#FFD23F" : "#3DD6E0";
        m.addLayer({ id: `z-${k}-fill`, type: "fill", source: "zones", filter: ["==", ["get", "kind"], k], paint: { "fill-color": col, "fill-opacity": 0, ...TF } });
        m.addLayer({ id: `z-${k}-line`, type: "line", source: "zones", filter: ["==", ["get", "kind"], k], paint: { "line-color": col, "line-width": 2, "line-opacity": 0, "line-dasharray": k === "landslide" ? [1, 0] : [3, 2], ...TL } });
      }
      // REAL OSM building footprints, coloured by the shelter reading. Flat fill in 2D; extruded by the real
      // storey count in 3D, so a building's height on screen is its tagged height, not a stylistic choice.
      m.addLayer({ id: "bldg-fill", type: "fill", source: "bldg", paint: { "fill-color": ["get", "color"], "fill-opacity": 0, "fill-opacity-transition": { duration: 600 } } });
      m.addLayer({ id: "bldg-line", type: "line", source: "bldg", paint: { "line-color": ["get", "color"], "line-width": 1, "line-opacity": 0, "line-opacity-transition": { duration: 600 } } });
      m.addLayer({ id: "bldg-3d", type: "fill-extrusion", source: "bldg", layout: { visibility: "none" }, paint: {
        "fill-extrusion-color": ["get", "color"],
        "fill-extrusion-height": ["*", ["coalesce", ["get", "floors"], 2], 3],
        "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.85 } });
      m.addLayer({ id: "closures-muted", type: "line", source: "closures", layout: { "line-cap": "round" }, paint: { "line-color": "#FFFFFF", "line-width": 2, "line-dasharray": [2, 3], "line-opacity": 0, ...TL } });
      m.addLayer({ id: "closures-minor", type: "line", source: "minor", layout: { "line-cap": "round" }, paint: { "line-color": RED, "line-width": 2, "line-opacity": 0, ...TL } });
      m.addLayer({ id: "closures-glow", type: "line", source: "closures", layout: { "line-cap": "round" }, paint: { "line-color": RED, "line-width": 12, "line-blur": 6, "line-opacity": 0, ...TL } });
      m.addLayer({ id: "closures", type: "line", source: "closures", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": RED, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 7], "line-opacity": 0, ...TL } });
      m.addLayer({ id: "pockets-minor", type: "line", source: "pockets", filter: ["==", ["get", "kind"], "pocket-minor"], layout: { "line-cap": "round" }, paint: { "line-color": AMBER, "line-width": 1.8, "line-opacity": 0, ...TL } });
      m.addLayer({ id: "pockets", type: "line", source: "pockets", filter: ["==", ["get", "kind"], "pocket"], layout: { "line-cap": "round" }, paint: { "line-color": AMBER, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.4, 15, 5], "line-dasharray": [2, 1.4], "line-opacity": 0, ...TL } });
      m.addLayer({ id: "affected-glow", type: "line", source: "affected", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 12, "line-blur": 6, "line-opacity": 0.5 } });
      m.addLayer({ id: "affected", type: "line", source: "affected", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6.5], "line-opacity": 1 } });
      m.addLayer({ id: "sel-fill", type: "fill", source: "sel", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#FFFFFF", "fill-opacity": 0.12 } });
      m.addLayer({ id: "sel-line", type: "line", source: "sel", filter: ["!=", ["geometry-type"], "Point"], layout: { "line-cap": "round" }, paint: { "line-color": "#FFFFFF", "line-width": 3.5, "line-opacity": 0.95 } });
      m.addLayer({ id: "rec-line", type: "line", source: "rec", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "hot"], 1], 4.5, 2.4], "line-dasharray": [2, 1.6] } });
      const dot = (id: string, kind: string, color: any, r: number, ring?: any) =>
        m.addLayer({ id: `pts-${id}`, type: "circle", source: "points", filter: ["==", ["get", "kind"], kind], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, r, 15, r + 3], "circle-color": color, "circle-stroke-color": ring ?? "#0A1217", "circle-stroke-width": ring ? 2.4 : 1.2, "circle-opacity": 1, "circle-opacity-transition": { duration: 600 } } });
      dot("dam", "dam", "#7CC4FF", 5);
      dot("tower", "tower", ["case", ["==", ["get", "status"], "down"], "#FF8E7A", "#59E0D0"], 3.6);
      // Building types get their own icons (hospital cross, school house, shelter tent, food crate, QRT shield).
      const kinds: [BuildingKind, string[]][] = [["hospital", ["none", "ok", "degraded", "lost"]], ["school", ["none", "ok", "risk", "high"]], ["airport", ["none", "ok", "degraded", "lost"]], ["helipad", ["none", "ok", "degraded", "lost"]], ["army", ["none", "ok", "degraded", "lost"]], ["shelter", ["base"]], ["food", ["base"]], ["qrt", ["base"]]];
      for (const [k, states] of kinds) for (const st of states) {
        const ring = (RING as Record<string, string>)[st === "base" ? "base" : st] ?? RING.none;
        m.addImage(`${k}-${st}`, drawIcon(k, ring, st === "risk" || st === "high" || st === "degraded" || st === "lost"), { pixelRatio: 2 });
      }
      const sym = (id: string, kind: string, image: any) =>
        m.addLayer({ id: `pts-${id}`, type: "symbol", source: "points", filter: ["==", ["get", "kind"], kind],
          layout: { "icon-image": image, "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.62, 14, 0.95, 17, 1.25], "icon-allow-overlap": true, "icon-ignore-placement": true },
          paint: { "icon-opacity": 1, "icon-opacity-transition": { duration: 600 } } });
      sym("shelter", "shelter", "shelter-base"); sym("food", "food", "food-base"); sym("qrt", "qrt", "qrt-base");
      sym("school", "school", "school-none"); sym("airport", "airport", "airport-none"); sym("helipad", "helipad", "helipad-none"); sym("army", "army", "army-none"); sym("hospital", "hospital", "hospital-none");
      // Atmosphere above flood/runoff/zones: soft heatmap clouds + smoothed isobars.
      m.addLayer({
        id: "atm-clouds", type: "heatmap", source: "atm-clouds", layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "cloud_cover"], 0, 0, 40, 0.45, 100, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.7, 14, 1.15],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 28, 12, 42, 15, 64],
          "heatmap-opacity": 0.72,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(232,240,248,0)",
            0.2, "rgba(210,224,236,0.25)",
            0.45, "rgba(200,216,230,0.45)",
            0.7, "rgba(230,238,246,0.62)",
            1, "rgba(248,252,255,0.78)",
          ],
        },
      });
      m.addLayer({
        id: "atm-isobars-glow", type: "line", source: "atm-isobars", layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#9EB6C8", "line-width": 5, "line-blur": 2.5, "line-opacity": 0.45 },
      });
      m.addLayer({
        id: "atm-isobars", type: "line", source: "atm-isobars", layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#F2F7FB", "line-width": 1.6, "line-opacity": 0.92 },
      });
      m.addLayer({
        id: "atm-centers", type: "symbol", source: "atm-centers", layout: {
          visibility: "none",
          "text-field": ["get", "label"],
          "text-size": 18,
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": ["match", ["get", "kind"], "high", "#FFFFFF", "low", "#9FD0FF", "#E8EEF2"],
          "text-halo-color": "#0A1217",
          "text-halo-width": 2,
        },
      });
      m.addLayer({ id: "rec-pt", type: "circle", source: "rec", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": ["case", ["==", ["get", "hot"], 1], 16, 12], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ["get", "color"], "circle-stroke-width": ["case", ["==", ["get", "hot"], 1], 4, 2.6] } });
      m.addLayer({ id: "sel-pt", type: "circle", source: "sel", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 3 } });

      const lookup = (id: string | undefined): Entity | undefined => (id === undefined ? undefined : BY_ID.get(id) ?? props.current.buildingById.get(id));
      const query = (pt: { x: number; y: number }) => {
        const layers = HIT.filter((id) => m.getLayer(id) && m.getLayoutProperty(id, "visibility") !== "none");
        return m.queryRenderedFeatures([[pt.x - 7, pt.y - 7], [pt.x + 7, pt.y + 7]], { layers }) as any[];
      };
      m.on("click", (e: any) => { const f = query(e.point).find((x) => lookup(x.properties?.id)); props.current.onSelect(f ? lookup(f.properties.id)! : null); });
      m.on("mousemove", (e: any) => {
        const f = query(e.point).find((x) => lookup(x.properties?.id)), t = tip.current;
        m.getCanvas().style.cursor = f ? "pointer" : "";
        if (!t) return;
        const w = !f && props.current.ran && m.getLayer("flood-fill") ? (m.queryRenderedFeatures(e.point, { layers: ["flood-fill"] }) as any[])[0] : null;
        if (w) { t.textContent = `Flood water, about ${Number(w.properties.d).toFixed(1)} m deep`; t.style.display = "block"; t.style.left = e.point.x + 14 + "px"; t.style.top = e.point.y + 14 + "px"; return; }
        if (f) { const ent = lookup(f.properties.id)!; t.textContent = ent.kind === "building" ? `${ent.name} — ${ent.props.roleLabel}` : ent.name; t.style.display = "block"; t.style.left = e.point.x + 14 + "px"; t.style.top = e.point.y + 14 + "px"; } else t.style.display = "none";
      });
      m.on("mouseout", () => { if (tip.current) tip.current.style.display = "none"; });
      ready.current = true;
      apply();
    });

    const apply = () => {
      const q = props.current, mm = map.current;
      if (!mm || !ready.current) return;
      const show = (id: string, on: boolean) => mm.getLayer(id) && mm.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      const vm = new Map(Object.entries(q.vis)), g = (k: string) => vm.get(k) === true, ran = q.ran;
      show("flood-fill", g("flood")); show("flood-waves", g("flood")); show("flood-edge", g("flood"));
      show("rain", g("weather")); show("low", g("terrain")); show("roads", g("roads"));
      const atm = q.atmosphere;
      if (atm) {
        (mm.getSource("atm-clouds") as any)?.setData(atm.clouds);
        (mm.getSource("atm-isobars") as any)?.setData(atm.isobars);
        (mm.getSource("atm-centers") as any)?.setData(atm.centers);
      }
      const atmOn = g("atmosphere") && !!atm && ((atm.clouds?.features?.length ?? 0) + (atm.isobars?.features?.length ?? 0) > 0);
      show("atm-clouds", atmOn); show("atm-isobars-glow", atmOn); show("atm-isobars", atmOn); show("atm-centers", atmOn);
      // Flood water rises in when the assessment runs; a larger share of the observed extent is shown as time advances (demo).
      const flowOn = ran && g("runoff");
      show("runoff-raster", g("runoff"));
      mm.setPaintProperty("runoff-raster", "raster-opacity", flowOn ? 0.85 : 0);
      if (q.flowUrl && runoffUrl.current !== q.flowUrl) {
        runoffUrl.current = q.flowUrl;
        (mm.getSource("runoff") as any)?.updateImage({ url: q.flowUrl, coordinates: [[BBOX[0], BBOX[3]], [BBOX[2], BBOX[3]], [BBOX[2], BBOX[1]], [BBOX[0], BBOX[1]]] });
      }
      const water = ran && g("flood");
      if (floodRef.current !== q.flood) { floodRef.current = q.flood; (mm.getSource("flood") as any)?.setData(q.flood); }
      for (const id of ["flood-fill", "flood-waves", "flood-edge"]) { show(id, g("flood")); mm.setFilter(id, [">", ["get", "d"], 0]); }
      mm.setPaintProperty("flood-fill", "fill-opacity", water ? 0.5 : 0);
      mm.setPaintProperty("flood-waves", "fill-opacity", water ? 0.9 : 0);
      mm.setPaintProperty("flood-edge", "line-opacity", water ? 0.75 : 0);
      show("pts-hospital", g("buildings")); show("pts-school", g("schools")); show("pts-airport", g("airports")); show("pts-helipad", g("helipads")); show("pts-army", g("army")); show("pts-tower", g("towers")); show("pts-dam", g("dams"));
      show("pts-shelter", g("shelter")); show("pts-food", g("food")); show("pts-qrt", g("qrt"));
      for (const k of ["landslide", "outage", "alert"]) {
        const on = ran && g(k === "landslide" ? "landslides" : k === "outage" ? "outages" : "alerts");
        show(`z-${k}-fill`, on); show(`z-${k}-line`, on);
      }
      const filt = ["all", ["<=", ["get", "stage"], q.stage], ["<", ["get", "order"], q.revealN]];
      mm.setFilter("closures", filt); mm.setFilter("closures-glow", filt);
      mm.setFilter("closures-muted", ["<=", ["get", "stage"], q.stage]);
      const dim = (id: string) => (q.focus && !(GROUP[q.focus] ?? []).includes(id) && Object.values(GROUP).flat().includes(id) ? 0.22 : 1);
      const set = (id: string, on: boolean, mult = 1) => mm.getLayer(id) && mm.setPaintProperty(id, OPACITY_PROP[id]!, on ? (BASE_OPACITY[id] ?? 1) * dim(id) * mult : 0);
      const closuresOn = ran && g("closures"), done = q.revealN >= GEO.closures.features.length;
      set("closures-muted", !ran && g("closures")); set("closures", closuresOn); set("closures-glow", closuresOn); set("closures-minor", closuresOn && done);
      set("pockets", closuresOn && q.showPockets); set("pockets-minor", closuresOn && q.showPockets);
      set("z-landslide-fill", ran && g("landslides")); set("z-landslide-line", ran && g("landslides")); set("z-outage-fill", ran && g("outages")); set("z-outage-line", ran && g("outages"));
      if (mm.getLayer("z-alert-fill")) { mm.setPaintProperty("z-alert-fill", "fill-opacity", ran && g("alerts") ? 0.22 : 0); mm.setPaintProperty("z-alert-line", "line-opacity", ran && g("alerts") ? 0.9 : 0); }
      mm.setLayoutProperty("pts-hospital", "icon-image", ran ? ["concat", "hospital-", ["get", "access"]] : "hospital-none");
      mm.setLayoutProperty("pts-school", "icon-image", ran ? ["concat", "school-", ["get", "risk"]] : "school-none");
      mm.setLayoutProperty("pts-airport", "icon-image", ran ? ["concat", "airport-", ["get", "access"]] : "airport-none");
      mm.setLayoutProperty("pts-helipad", "icon-image", ran ? ["concat", "helipad-", ["get", "access"]] : "helipad-none");
      mm.setLayoutProperty("pts-army", "icon-image", ran ? ["concat", "army-", ["get", "access"]] : "army-none");
      set("pts-hospital", g("buildings")); set("pts-school", g("schools"));
      for (const [id, key] of [["pts-airport", "airports"], ["pts-helipad", "helipads"], ["pts-army", "army"]] as const) {
        mm.setPaintProperty(id, "icon-opacity", g(key) ? 1 : 0);
      }
      // Real building footprints: flat in 2D, extruded by their real storey count in 3D. Only shown after a run,
      // because the shelter reading depends on the flood depth the agents compute.
      if (bldgRef.current !== q.buildings) { bldgRef.current = q.buildings; (mm.getSource("bldg") as any)?.setData(q.buildings ?? { type: "FeatureCollection", features: [] }); }
      const bOn = ran && g("shelterBuildings");
      show("bldg-fill", bOn && !q.view3d); show("bldg-line", bOn && !q.view3d); show("bldg-3d", bOn && q.view3d);
      mm.setPaintProperty("bldg-fill", "fill-opacity", bOn && !q.view3d ? 0.7 : 0);
      mm.setPaintProperty("bldg-line", "line-opacity", bOn && !q.view3d ? 0.9 : 0);
      const sel = mm.getSource("sel"), rec = mm.getSource("rec");
      sel?.setData(q.selected ? { type: "Feature", properties: {}, geometry: q.selected.kind === "closure" || q.selected.kind === "pocket" || q.selected.kind === "landslide" || q.selected.kind === "outage" || q.selected.kind === "alert" || q.selected.kind === "building" ? q.selected.geom : { type: "Point", coordinates: q.selected.at } } : { type: "FeatureCollection", features: [] });
      const recs = q.selected ? q.recs : [];
      rec?.setData({ type: "FeatureCollection", features: recs.flatMap((r) => {
        const props = { id: r.id, color: REC_COLOR[r.kind] ?? "#6FE3D1", hot: q.hover === r.id ? 1 : 0 };
        return [
          { type: "Feature", properties: props, geometry: { type: "LineString", coordinates: [q.selected!.at, r.at] } },
          { type: "Feature", properties: props, geometry: { type: "Point", coordinates: r.at } }];
      }) });
      // Labels: DOM markers (the map has no font glyphs), one per recommended link, at the midpoint.
      markers.current.forEach((mk) => mk.remove()); markers.current = [];
      recs.forEach((r) => {
        const el = document.createElement("div");
        el.className = "reclabel" + (q.hover === r.id ? " hot" : "");
        el.style.borderLeftColor = REC_COLOR[r.kind] ?? "#6FE3D1";
        el.textContent = r.label;
        const mid: [number, number] = [(q.selected!.at[0] + r.at[0]) / 2, (q.selected!.at[1] + r.at[1]) / 2];
        markers.current.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(mid).addTo(mm));
      });
    };
    (m as any).__apply = apply;
    return () => { m.remove(); map.current = null; ready.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { (map.current as any)?.__apply?.(); }, [p.ran, p.revealN, p.showPockets, p.stage, p.vis, p.focus, p.selected, p.recs, p.hover, p.flood, p.flowUrl, p.buildings, p.view3d, p.atmosphere]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const a = p.atmosphere;
    (m.getSource("atm-clouds") as any)?.setData(a?.clouds ?? EMPTY_FC);
    (m.getSource("atm-isobars") as any)?.setData(a?.isobars ?? EMPTY_FC);
    (m.getSource("atm-centers") as any)?.setData(a?.centers ?? EMPTY_FC);
  }, [p.atmosphere]);

  // Flow streaks: calm particles that run down the slope of the real elevation grid. They are drawn at screen resolution and move at
  // a fixed gentle speed on screen, they start mostly in the main channels, and they stop when the map moves. Skipped when the
  // user prefers reduced motion.
  useEffect(() => {
    const cv = flowCv.current, m = map.current, f = p.field;
    if (!cv || !m) return;
    const ctx = cv.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const size = () => { cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!p.ran || !p.vis["runoff"] || !f || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const { grid, gx, gy, acc } = f, N = 220 + Math.round(p.rainIn * 22);
    const px = new Float32Array(N), py = new Float32Array(N), life = new Float32Array(N);
    const lonAt = (x: number) => grid.lon0 + (x / grid.w) * (grid.lon1 - grid.lon0), latAt = (y: number) => grid.lat1 - (y / grid.h) * (grid.lat1 - grid.lat0);
    const spawn = (i: number) => {
      for (let t = 0; t < 40; t++) {
        const x = 2 + Math.random() * (grid.w - 5), y = 2 + Math.random() * (grid.h - 5), a = acc[Math.floor(y) * grid.w + Math.floor(x)]!;
        if ((a > 30 && Math.random() < 0.9) || (a > 6 && Math.random() < 0.12) || t === 39) { px[i] = x; py[i] = y; life[i] = 90 + Math.random() * 120; return; }
      }
    };
    for (let i = 0; i < N; i++) { spawn(i); life[i]! *= Math.random(); }
    const clear = () => ctx.clearRect(0, 0, cv.width, cv.height);
    m.on("movestart", clear); m.on("move", clear);
    const onResize = () => { size(); clear(); };
    window.addEventListener("resize", onResize);
    let raf = 0;
    const tick = () => {
      const cx = grid.w / 2, cy = grid.h / 2, a = m.project([lonAt(cx), latAt(cy)]), b = m.project([lonAt(cx + 1), latAt(cy)]);
      const pxPerCell = Math.max(0.2, Math.hypot(b.x - a.x, b.y - a.y));
      ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "rgba(0,0,0,0.05)"; ctx.fillRect(0, 0, cv.clientWidth, cv.clientHeight);
      ctx.globalCompositeOperation = "source-over"; ctx.strokeStyle = "rgba(210,240,255,0.8)"; ctx.lineWidth = 1.6; ctx.lineCap = "round"; ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const k = Math.floor(py[i]!) * grid.w + Math.floor(px[i]!), ax = -gx[k]!, ay = -gy[k]!, mag = Math.hypot(ax, ay);
        if (life[i]! <= 0 || mag < 0.003 || px[i]! < 2 || py[i]! < 2 || px[i]! > grid.w - 3 || py[i]! > grid.h - 3) { spawn(i); continue; }
        const stepCells = (0.25 + Math.min(0.5, mag * 4)) / pxPerCell, nx = px[i]! + (ax / mag) * stepCells, ny = py[i]! + (ay / mag) * stepCells;
        const p0 = m.project([lonAt(px[i]!), latAt(py[i]!)]), p1 = m.project([lonAt(nx), latAt(ny)]);
        ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); px[i] = nx; py[i] = ny; life[i]! -= 1;
      }
      ctx.stroke(); raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); m.off("movestart", clear); m.off("move", clear); window.removeEventListener("resize", onResize); clear(); };
  }, [p.ran, p.vis, p.field, p.rainIn]);

  // Ripple the flood water by stepping through the wave frames (skipped when the user prefers reduced motion).
  useEffect(() => {
    const m = map.current;
    if (!p.ran || !m || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let k = 0;
    const t = window.setInterval(() => {
      if (!ready.current || !m.getLayer("flood-waves") || m.getLayoutProperty("flood-waves", "visibility") === "none") return;
      k = (k + 1) % WAVE_FRAMES; m.setPaintProperty("flood-waves", "fill-pattern", `wave-${k}`);
    }, 140);
    return () => window.clearInterval(t);
  }, [p.ran]);

  // Status-strip filter: zoom to the affected area and light up the affected roads.
  const closuresDone = p.ran && p.revealN >= p.scene.geo.closures.features.length;
  useEffect(() => {
    const m = map.current; if (!m) return;
    const go = () => {
      const src = m.getSource("affected"); if (!src) return;
      if (p.focus && closuresDone) {
        const a = affected(p.scene, p.focus, p.stage); src.setData(a.fc);
        const wide = window.innerWidth > 900;
        if (a.bounds && !props.current.selected) m.fitBounds(a.bounds, { padding: wide ? { top: 80, bottom: 50, left: 330, right: 60 } : { top: 80, bottom: 50, left: 24, right: 24 }, maxZoom: 14.3, duration: 900 });
      } else src.setData({ type: "FeatureCollection", features: [] });
    };
    if (ready.current) go(); else m.once("load", go);
  }, [p.focus, p.stage, closuresDone, p.scene]);

  // 2D / 3D: terrain, hillshade and a tilted camera.
  useEffect(() => {
    const m = map.current; if (!m) return;
    const go = () => {
      if (p.view3d) {
        m.setTerrain({ source: "dem", exaggeration: 1.7 });
        m.setLayoutProperty("hill", "visibility", "visible");
        m.dragRotate.enable();
        m.easeTo({ pitch: 62, bearing: -24, duration: 1300 });
      } else {
        m.setTerrain(null);
        m.setLayoutProperty("hill", "visibility", "none");
        m.dragRotate.disable();
        m.easeTo({ pitch: 0, bearing: 0, duration: 900 });
      }
    };
    if (ready.current) go(); else if (p.view3d) m.once("load", go);
  }, [p.view3d]);

  // Flythrough: tilt the camera and follow the selected road, or orbit the selected site (DEMO camera path).
  useEffect(() => {
    const m = map.current, sel = props.current.selected;
    cancelAnimationFrame(raf.current);
    if (!p.flying || !m || !sel) return;
    const wide = window.innerWidth > 900;
    const padding = wide ? { top: 0, bottom: 0, left: 300, right: 430 } : { top: 0, bottom: 300, left: 0, right: 0 };
    const rad = (d: number) => (d * Math.PI) / 180;
    const bearing = (a: [number, number], b: [number, number]) => {
      const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
      const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
      return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    };
    const km = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 98.6, (a[1] - b[1]) * 110.6);
    const g = sel.geom;
    const path = g.type === "MultiLineString" ? g.coordinates.reduce((a, b) => (b.length > a.length ? b : a)) : null;
    const cum: number[] = [0];
    if (path) for (let i = 1; i < path.length; i++) cum.push(cum[i - 1]! + km(path[i - 1]!, path[i]!));
    const total = cum[cum.length - 1] ?? 0;
    const at = (d: number): [number, number] => {
      if (!path) return sel.at;
      const dd = Math.max(0, Math.min(total, d));
      let i = 1; while (i < cum.length - 1 && cum[i]! < dd) i++;
      const seg = cum[i]! - cum[i - 1]! || 1, f = (dd - cum[i - 1]!) / seg, a = path[i - 1]!, b = path[i]!;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    };
    const useRoute = !!path && total > 0.15;
    const dur = useRoute ? Math.max(14000, Math.min(45000, total * 14000)) : 22000;
    const zoom = useRoute ? 15.3 : sel.kind === "landslide" || sel.kind === "alert" ? 13.9 : 15.4;
    let cur = useRoute ? bearing(at(0), at(0.2)) : 0;
    const t0 = performance.now();
    const stop = () => props.current.onFlyEnd();
    for (const ev of ["mousedown", "wheel", "touchstart"]) m.once(ev, stop);
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      let center: [number, number], target: number;
      if (useRoute) { center = at(total * k); target = bearing(center, at(total * k + 0.18)); }
      else { center = sel.at; target = (k * 300) % 360; }
      const diff = ((target - cur + 540) % 360) - 180;
      cur = (cur + diff * (useRoute ? 0.08 : 1) + 360) % 360;
      m.jumpTo({ center, bearing: cur, pitch: 68, zoom, padding });
      if (bar.current) bar.current.style.width = `${Math.round(k * 100)}%`;
      if (k < 1) raf.current = requestAnimationFrame(tick); else stop();
    };
    m.jumpTo({ center: at(0), bearing: cur, pitch: 68, zoom, padding });
    raf.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf.current); for (const ev of ["mousedown", "wheel", "touchstart"]) m.off(ev, stop); };
  }, [p.flying]);

  useEffect(() => {
    const m = map.current; if (!m || !p.selected || props.current.flying) return;
    const wide = window.innerWidth > 900;
    const pad = wide ? { top: 70, right: 450, bottom: 30, left: 320 } : { top: 70, right: 20, bottom: 340, left: 20 };
    const g = p.selected.geom;
    // Fit the selection and every resource it links to, so the labelled links are in view.
    const pts = [...(g.type === "Point" ? [g.coordinates] : (g.coordinates as unknown[]).flat(1)), ...props.current.recs.map((r) => r.at)] as [number, number][];
    const xs = pts.map((c) => c[0]), ys = pts.map((c) => c[1]);
    m.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: pad, maxZoom: props.current.recs.length ? 13.6 : 14.2, duration: 800 });
  }, [p.selected]);

  return (
    <div className="mapstage">
      <div ref={box} className="map" />
      <canvas ref={flowCv} className="flowcv" aria-hidden="true" />
      <div ref={tip} className="maptip" />
      {p.flying && (
        <div className="flybar" role="status">
          <div className="fly-track"><i ref={bar} /></div>
          <span>Flythrough</span>
          <button onClick={p.onFlyEnd}>Stop</button>
        </div>
      )}
    </div>
  );
}
