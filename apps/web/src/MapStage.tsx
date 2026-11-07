import { useEffect, useRef } from "react";
import { maplibregl } from "./mapsetup.ts";
import satUrl from "./assets/valley.jpg?url";
import { affected, BBOX, BY_ID, GEO, type Entity } from "./mock/demo.ts";

export type Vis = Record<string, boolean>;
export type MapProps = {
  ran: boolean; revealN: number; showPockets: boolean; stage: number; vis: Vis; focus: string | null;
  selected: Entity | null; recommended: Entity[]; onSelect: (e: Entity | null) => void; compact: boolean; view3d: boolean;
};

const RED = "#FF4A3D", AMBER = "#FFB020";
const HIT = ["pts-hospital", "pts-tower", "pts-dam", "pts-social", "pts-radio", "pts-shelter", "pts-food", "pts-qrt", "closures", "closures-muted", "pockets", "z-landslide-fill", "z-outage-fill", "z-alert-fill"];
const GROUP: Record<string, string[]> = {
  closures: ["closures-glow", "closures", "closures-minor", "closures-muted"], pockets: ["pockets", "pockets-minor"],
  landslides: ["z-landslide-fill", "z-landslide-line"], hospitals: ["pts-hospital"], outages: ["z-outage-fill", "z-outage-line"],
};
const OPACITY_PROP: Record<string, string> = {
  "closures-glow": "line-opacity", closures: "line-opacity", "closures-minor": "line-opacity", "closures-muted": "line-opacity", pockets: "line-opacity", "pockets-minor": "line-opacity",
  "z-landslide-fill": "fill-opacity", "z-landslide-line": "line-opacity", "pts-hospital": "circle-opacity", "z-outage-fill": "fill-opacity", "z-outage-line": "line-opacity",
};
const BASE_OPACITY: Record<string, number> = {
  "closures-glow": 0.45, closures: 1, "closures-minor": 0.8, "closures-muted": 0.4, pockets: 1, "pockets-minor": 0.7,
  "z-landslide-fill": 0.38, "z-landslide-line": 0.95, "pts-hospital": 1, "z-outage-fill": 0.2, "z-outage-line": 0.9,
};

export function MapStage(p: MapProps) {
  const box = useRef<HTMLDivElement>(null), tip = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null), ready = useRef(false), props = useRef(p);
  props.current = p;

  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current, attributionControl: false, dragRotate: false, pitchWithRotate: true, maxPitch: 78,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0A1217" } }] },
      bounds: [[BBOX[0], BBOX[1]], [BBOX[2], BBOX[3]]], fitBoundsOptions: { padding: { top: 64, bottom: 24, left: props.current.compact ? 16 : 310, right: 16 } },
      maxZoom: 18,
    });
    map.current = m;
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "DEMO DATA · Base: Esri World Imagery (Maxar), Sentinel-2 EOX fallback · Roads: © OpenStreetMap contributors" }), "bottom-right");
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    m.on("load", () => {
      const TL = { "line-opacity-transition": { duration: 600 } }, TF = { "fill-opacity-transition": { duration: 600 } };
      m.addSource("sat", { type: "image", url: satUrl, coordinates: [[BBOX[0], BBOX[3]], [BBOX[2], BBOX[3]], [BBOX[2], BBOX[1]], [BBOX[0], BBOX[1]]] });
      for (const [id, data] of Object.entries({ roads: GEO.roads, closures: GEO.closures, minor: GEO.minor, pockets: GEO.pockets, zones: GEO.zones, points: GEO.points, low: GEO.low, rain: GEO.rain }))
        m.addSource(id, { type: "geojson", data });
      const empty = { type: "FeatureCollection", features: [] };
      m.addSource("sel", { type: "geojson", data: empty });
      m.addSource("rec", { type: "geojson", data: empty });
      m.addSource("affected", { type: "geojson", data: empty });
      m.addSource("dem", { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: "Terrain: Mapzen / AWS Terrain Tiles" });

      m.addLayer({ id: "sat", type: "raster", source: "sat", paint: { "raster-opacity": 0.9, "raster-saturation": -0.45, "raster-brightness-max": 0.95, "raster-contrast": 0.15 } });
      // Sharper imagery streamed as tiles (about 0.5 m near Kathmandu). The dimmed 10 m mosaic above stays as the offline fallback.
      m.addSource("esri", { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 18, attribution: "Imagery: Esri, Maxar, Earthstar Geographics" });
      m.addLayer({ id: "esri", type: "raster", source: "esri", paint: { "raster-opacity": 0.92, "raster-saturation": -0.35, "raster-brightness-max": 0.92, "raster-contrast": 0.12, "raster-fade-duration": 250 } });
      m.addLayer({ id: "hill", type: "hillshade", source: "dem", layout: { visibility: "none" }, paint: { "hillshade-exaggeration": 0.55, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#BFD2DA", "hillshade-accent-color": "#4A5B64" } });
      m.addLayer({ id: "rain", type: "fill", source: "rain", paint: { "fill-color": "#4DA3FF", "fill-opacity": ["interpolate", ["linear"], ["get", "v"], 2, 0.1, 3, 0.18] } });
      m.addLayer({ id: "low", type: "fill", source: "low", paint: { "fill-color": "#2B7BFF", "fill-opacity": 0.28, "fill-outline-color": "#6FB0FF" } });
      m.addLayer({ id: "roads", type: "line", source: "roads", layout: { "line-cap": "round" }, paint: {
        "line-color": ["match", ["get", "c"], 0, "#E4ECF0", 1, "#D3DEE4", 2, "#A9BAC4", "#8497A2"],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, ["match", ["get", "c"], 0, 1.3, 1, 1.1, 0.6], 15, ["match", ["get", "c"], 0, 4, 1, 3.4, 2, 2.4, 1.6]],
        "line-opacity": 0.75 } });
      for (const k of ["landslide", "outage", "alert"]) {
        const col = k === "landslide" ? "#FF7A1A" : k === "outage" ? "#FFD23F" : "#3DD6E0";
        m.addLayer({ id: `z-${k}-fill`, type: "fill", source: "zones", filter: ["==", ["get", "kind"], k], paint: { "fill-color": col, "fill-opacity": 0, ...TF } });
        m.addLayer({ id: `z-${k}-line`, type: "line", source: "zones", filter: ["==", ["get", "kind"], k], paint: { "line-color": col, "line-width": 2, "line-opacity": 0, "line-dasharray": k === "landslide" ? [1, 0] : [3, 2], ...TL } });
      }
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
      m.addLayer({ id: "rec-line", type: "line", source: "rec", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#6FE3D1", "line-width": 2.2, "line-dasharray": [2, 2] } });
      const dot = (id: string, kind: string, color: any, r: number, ring?: any) =>
        m.addLayer({ id: `pts-${id}`, type: "circle", source: "points", filter: ["==", ["get", "kind"], kind], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, r, 15, r + 3], "circle-color": color, "circle-stroke-color": ring ?? "#0A1217", "circle-stroke-width": ring ? 2.4 : 1.2, "circle-opacity": 1, "circle-opacity-transition": { duration: 600 } } });
      dot("dam", "dam", "#7CC4FF", 5);
      dot("social", "social", "#9BC2D6", 3.4);
      dot("radio", "radio", "#B8E0C4", 3.4);
      dot("tower", "tower", ["case", ["==", ["get", "status"], "down"], "#FF8E7A", "#59E0D0"], 3.6);
      dot("shelter", "shelter", "#86EFAC", 5);
      dot("food", "food", "#FDE68A", 5);
      dot("qrt", "qrt", "#93C5FD", 5);
      dot("hospital", "hospital", "#FFFFFF", 6.5, "#FFFFFF");
      m.addLayer({ id: "rec-pt", type: "circle", source: "rec", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#6FE3D1", "circle-stroke-width": 2.4 } });
      m.addLayer({ id: "sel-pt", type: "circle", source: "sel", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 3 } });

      const query = (pt: { x: number; y: number }) => {
        const layers = HIT.filter((id) => m.getLayer(id) && m.getLayoutProperty(id, "visibility") !== "none");
        return m.queryRenderedFeatures([[pt.x - 7, pt.y - 7], [pt.x + 7, pt.y + 7]], { layers }) as any[];
      };
      m.on("click", (e: any) => { const f = query(e.point).find((x) => BY_ID.has(x.properties?.id)); props.current.onSelect(f ? BY_ID.get(f.properties.id)! : null); });
      m.on("mousemove", (e: any) => {
        const f = query(e.point).find((x) => BY_ID.has(x.properties?.id)), t = tip.current;
        m.getCanvas().style.cursor = f ? "pointer" : "";
        if (!t) return;
        if (f) { t.textContent = BY_ID.get(f.properties.id)!.name; t.style.display = "block"; t.style.left = e.point.x + 14 + "px"; t.style.top = e.point.y + 14 + "px"; } else t.style.display = "none";
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
      show("rain", g("weather")); show("low", g("terrain")); show("roads", g("roads"));
      show("pts-hospital", g("buildings")); show("pts-tower", g("towers")); show("pts-dam", g("dams")); show("pts-social", g("social")); show("pts-radio", g("radio"));
      show("pts-shelter", g("shelter")); show("pts-food", g("food")); show("pts-qrt", g("qrt"));
      for (const k of ["landslide", "outage", "alert"]) { const on = ran && g(k === "landslide" ? "landslides" : k === "outage" ? "outages" : "alerts"); show(`z-${k}-fill`, on); show(`z-${k}-line`, on); }
      const filt = ["all", ["<=", ["get", "stage"], q.stage], ["<", ["get", "order"], q.revealN]];
      mm.setFilter("closures", filt); mm.setFilter("closures-glow", filt);
      mm.setFilter("closures-muted", ["<=", ["get", "stage"], q.stage]);
      const dim = (id: string) => (q.focus && !(GROUP[q.focus] ?? []).includes(id) && Object.values(GROUP).flat().includes(id) ? 0.22 : 1);
      const set = (id: string, on: boolean, mult = 1) => mm.getLayer(id) && mm.setPaintProperty(id, OPACITY_PROP[id]!, on ? (BASE_OPACITY[id] ?? 1) * dim(id) * mult : 0);
      const closuresOn = ran && g("closures"), done = q.revealN >= GEO.closures.features.length;
      set("closures-muted", !ran && g("closures")); set("closures", closuresOn); set("closures-glow", closuresOn); set("closures-minor", closuresOn && done);
      set("pockets", closuresOn && q.showPockets); set("pockets-minor", closuresOn && q.showPockets);
      set("z-landslide-fill", ran && g("landslides")); set("z-landslide-line", ran && g("landslides")); set("z-outage-fill", ran && g("outages")); set("z-outage-line", ran && g("outages"));
      const hosp = ran ? ["match", ["get", "access"], "lost", "#FF4A3D", "degraded", "#FFB020", "#46D68C"] : "#FFFFFF";
      mm.setPaintProperty("pts-hospital", "circle-stroke-color", hosp);
      set("pts-hospital", g("buildings"));
      const sel = mm.getSource("sel"), rec = mm.getSource("rec");
      sel?.setData(q.selected ? { type: "Feature", properties: {}, geometry: q.selected.kind === "closure" || q.selected.kind === "pocket" || q.selected.kind === "landslide" || q.selected.kind === "outage" || q.selected.kind === "alert" ? q.selected.geom : { type: "Point", coordinates: q.selected.at } } : { type: "FeatureCollection", features: [] });
      rec?.setData({ type: "FeatureCollection", features: q.selected ? q.recommended.flatMap((r) => [
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [q.selected!.at, r.at] } },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: r.at } }]) : [] });
    };
    (m as any).__apply = apply;
    return () => { m.remove(); map.current = null; ready.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { (map.current as any)?.__apply?.(); }, [p.ran, p.revealN, p.showPockets, p.stage, p.vis, p.focus, p.selected, p.recommended]);

  // Status-strip filter: zoom to the affected area and light up the affected roads.
  const closuresDone = p.ran && p.revealN >= GEO.closures.features.length;
  useEffect(() => {
    const m = map.current; if (!m) return;
    const go = () => {
      const src = m.getSource("affected"); if (!src) return;
      if (p.focus && closuresDone) {
        const a = affected(p.focus, p.stage); src.setData(a.fc);
        const wide = window.innerWidth > 900;
        if (a.bounds && !props.current.selected) m.fitBounds(a.bounds, { padding: wide ? { top: 80, bottom: 50, left: 330, right: 60 } : { top: 80, bottom: 50, left: 24, right: 24 }, maxZoom: 14.3, duration: 900 });
      } else src.setData({ type: "FeatureCollection", features: [] });
    };
    if (ready.current) go(); else m.once("load", go);
  }, [p.focus, p.stage, closuresDone]);

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

  useEffect(() => {
    const m = map.current; if (!m || !p.selected) return;
    const wide = window.innerWidth > 900;
    const pad = wide ? { top: 70, right: 450, bottom: 30, left: 320 } : { top: 70, right: 20, bottom: 340, left: 20 };
    const g = p.selected.geom;
    if (g.type === "MultiLineString" || g.type === "Polygon") {
      const pts = g.coordinates.flat() as [number, number][];
      const xs = pts.map((c) => c[0]), ys = pts.map((c) => c[1]);
      m.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: pad, maxZoom: 14.2, duration: 700 });
      return;
    }
    m.easeTo({ center: p.selected.at, zoom: Math.max(m.getZoom(), p.selected.kind === "landslide" || p.selected.kind === "alert" ? 12.6 : 13.4), duration: 700,
      padding: wide ? { top: 44, right: 430, bottom: 0, left: 300 } : { top: 44, right: 0, bottom: 320, left: 0 } });
  }, [p.selected]);

  return (
    <div className="mapstage">
      <div ref={box} className="map" />
      <div ref={tip} className="maptip" />
    </div>
  );
}
