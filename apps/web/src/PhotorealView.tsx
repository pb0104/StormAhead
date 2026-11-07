import { useEffect, useRef, useState } from "react";
import { BY_ID, FLOOD_POLYS, type Entity } from "./mock/demo.ts";
import { iconDataUrl, RING, type BuildingKind } from "./icons.ts";

/**
 * Photoreal close-up of ONE selected item: CesiumJS plus Google Photorealistic 3D Tiles through Cesium ion (free ion token).
 * Opened from the drawer's "View in photoreal". Only the selected item and the resources it links to are drawn (DEMO fixtures).
 * Cesium loads from a CDN only when this view opens, so the default console has no extra dependency.
 */
declare global { interface Window { Cesium?: any; CESIUM_BASE_URL?: string } }
const V = "1.147.0", BASE = `https://cdn.jsdelivr.net/npm/cesium@${V}/Build/Cesium/`, GOOGLE_ASSET = 2275207, KTM_ELEV = 1300;
const BUILDING = new Set(["hospital", "school", "shelter", "food", "qrt", "airport", "army"]);

let loading: Promise<any> | null = null;
function loadCesium(): Promise<any> {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  return (loading ??= new Promise((resolve, reject) => {
    window.CESIUM_BASE_URL = BASE;
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = BASE + "Widgets/widgets.css"; document.head.appendChild(css);
    const s = document.createElement("script"); s.src = BASE + "Cesium.js";
    s.onload = () => resolve(window.Cesium); s.onerror = () => { loading = null; reject(new Error("Could not load CesiumJS from the CDN. Check your internet connection.")); };
    document.head.appendChild(s);
  }));
}

export const TOKEN_KEY = "cascadeiq.cesiumToken";
export function savedToken(): string {
  const env = (import.meta as any).env?.VITE_CESIUM_TOKEN as string | undefined;
  try { return env || localStorage.getItem(TOKEN_KEY) || ""; } catch { return env || ""; }
}

const ringFor = (e: Entity, ran: boolean) => !ran ? RING.none : (e.kind === "hospital" || e.kind === "airport" || e.kind === "army" ? (RING as Record<string, string>)[String(e.props.access)] : e.kind === "school" ? (RING as Record<string, string>)[String(e.props.risk)] : RING.base) ?? RING.none;
const COLOR: Record<string, string> = { closure: "#FF4A3D", pocket: "#FFB020", landslide: "#FF7A1A", outage: "#FFD23F", alert: "#3DD6E0" };
const geoPts = (e: Entity): [number, number][] => e.geom.type === "Point" ? [e.geom.coordinates] : ((e.geom.coordinates as unknown[]).flat(1) as [number, number][]);

export function PhotorealView({ token, setToken, ran, selected, linked, depths, onClose }: { token: string; setToken: (t: string) => void; ran: boolean; selected: Entity; linked: string[]; depths: number[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null), viewer = useRef<any>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [streamed, setStreamed] = useState(false);
  const [msg, setMsg] = useState(""), [draft, setDraft] = useState("");
  const [showLinked, setShowLinked] = useState(true);
  const [showWater, setShowWater] = useState(true);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Start Cesium and the Google tiles once a token exists.
  useEffect(() => {
    if (!token || !box.current) return;
    let dead = false;
    setState("loading"); setStreamed(false);
    (async () => {
      try {
        const C = await loadCesium();
        if (dead || !box.current) return;
        C.Ion.defaultAccessToken = token;
        const v = new C.Viewer(box.current, { baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, shouldAnimate: false });
        viewer.current = v;
        v.scene.globe.show = false;
        const tiles = await C.Cesium3DTileset.fromIonAssetId(GOOGLE_ASSET);
        if (dead) { v.destroy(); return; }
        v.scene.primitives.add(tiles);
        tiles.allTilesLoaded.addEventListener(() => setStreamed(true));
        // Start already looking at the item, above the ground and not the ellipsoid, so there is no long flight from far away.
        const pts = geoPts(selected), cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        const sphere = C.BoundingSphere.fromPoints(pts.map((p) => C.Cartesian3.fromDegrees(p[0], p[1], KTM_ELEV)));
        const range = Math.max(450, sphere.radius * 2.6);
        v.camera.lookAt(C.Cartesian3.fromDegrees(cx, cy, KTM_ELEV), new C.HeadingPitchRange(C.Math.toRadians(20), C.Math.toRadians(-35), range));
        v.camera.lookAtTransform(C.Matrix4.IDENTITY);
        setState("ready");
      } catch (e) { if (!dead) { setMsg((e as Error).message || "Could not start the photoreal view."); setState("error"); } }
    })();
    return () => { dead = true; try { viewer.current?.destroy(); } catch { /* ignore */ } viewer.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Draw the selected item, and optionally the resources it links to.
  // Lines and polygons are draped on the tiles. Icons are placed at a height sampled from the tiles, because "clamp to ground"
  // can leave a billboard hidden when the tiles under it are still streaming.
  useEffect(() => {
    const v = viewer.current, C = window.Cesium;
    if (state !== "ready" || !v || !C) return;
    let dead = false;
    v.entities.removeAll();
    const points: { e: Entity; tag: string; main: boolean }[] = [];
    const draw = (e: Entity, tag: string, main: boolean) => {
      const g = e.geom, id = `${tag}:${e.id}`;
      if (g.type === "MultiLineString") g.coordinates.forEach((l, i) => v.entities.add({ id: `${id}#${i}`, polyline: { positions: C.Cartesian3.fromDegreesArray(l.flat()), width: main ? 8 : 5, clampToGround: true, classificationType: C.ClassificationType.BOTH, material: C.Color.fromCssColorString(COLOR[e.kind] ?? "#FFFFFF") } }));
      else if (g.type === "Polygon") v.entities.add({ id, polygon: { hierarchy: C.Cartesian3.fromDegreesArray(g.coordinates[0]!.flat()), classificationType: C.ClassificationType.BOTH, material: C.Color.fromCssColorString(COLOR[e.kind] ?? "#FFFFFF").withAlpha(0.3) } });
      else if (g.type === "Point") points.push({ e, tag, main });
    };
    draw(selected, "sel", true);
    if (showLinked) linked.forEach((id) => { const t = BY_ID.get(id); if (t && t.id !== selected.id) draw(t, "lnk", false); });
    (async () => {
      const carto = points.map(({ e }) => C.Cartographic.fromDegrees((e.geom as { coordinates: [number, number] }).coordinates[0], (e.geom as { coordinates: [number, number] }).coordinates[1]));
      let heights: (number | undefined)[] = [];
      try {
        heights = await Promise.race([
          v.scene.sampleHeightMostDetailed(carto).then((r: any[]) => r.map((c) => c.height as number | undefined)),
          new Promise<(number | undefined)[]>((res) => setTimeout(() => res([]), 5000)),
        ]);
      } catch { /* fall back below */ }
      if (dead || v.isDestroyed()) return;
      points.forEach(({ e, tag, main }, i) => {
        const [lon, lat] = (e.geom as { coordinates: [number, number] }).coordinates;
        const h = typeof heights[i] === "number" && heights[i]! > 200 && heights[i]! < 3000 ? heights[i]! : KTM_ELEV;
        const pos = C.Cartesian3.fromDegrees(lon, lat, h + 6), id = `${tag}:${e.id}`;
        if (BUILDING.has(e.kind)) {
          const badge = ran && (e.props.risk === "risk" || e.props.risk === "high" || e.props.access === "degraded" || e.props.access === "lost");
          v.entities.add({ id, position: pos, billboard: { image: iconDataUrl(e.kind as BuildingKind, ringFor(e, ran), badge), scale: main ? 0.8 : 0.6, disableDepthTestDistance: Number.POSITIVE_INFINITY, verticalOrigin: C.VerticalOrigin.BOTTOM } });
        } else v.entities.add({ id, position: pos, point: { pixelSize: main ? 14 : 10, color: C.Color.WHITE, outlineColor: C.Color.fromCssColorString("#0B1318"), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
      });
    })();
    return () => { dead = true; };
  }, [state, ran, selected, linked, showLinked]);

  // Flood water: the observed extent near the item, as an animated water surface at the local ground height.
  useEffect(() => {
    const v = viewer.current, C = window.Cesium;
    if (state !== "ready" || !v || !C || !showWater || !ran) return;
    let dead = false, prim: any = null;
    const mid = (() => { const q = geoPts(selected); return [q.reduce((a, c) => a + c[0], 0) / q.length, q.reduce((a, c) => a + c[1], 0) / q.length] as [number, number]; })();
    const near = FLOOD_POLYS.map((f, i) => ({ ...f, d: depths[i] ?? 0 })).filter((f) => f.d > 0 && f.ring.some((c) => Math.hypot((c[0] - mid[0]) * 98.6, (c[1] - mid[1]) * 110.6) < 3.5)).slice(0, 40);
    if (!near.length) return;
    (async () => {
      const cents = near.map((f) => { const n = f.ring.length; return [f.ring.reduce((a, c) => a + c[0], 0) / n, f.ring.reduce((a, c) => a + c[1], 0) / n]; });
      let hs: (number | undefined)[] = [];
      try {
        hs = await Promise.race([
          v.scene.sampleHeightMostDetailed(cents.map((c) => C.Cartographic.fromDegrees(c[0]!, c[1]!))).then((r: any[]) => r.map((c) => c.height as number | undefined)),
          new Promise<(number | undefined)[]>((res) => setTimeout(() => res([]), 6000)),
        ]);
      } catch { /* use the fallback height */ }
      if (dead || v.isDestroyed()) return;
      try {
        const instances = near.map((f, i) => {
          const h = typeof hs[i] === "number" && hs[i]! > 200 && hs[i]! < 3000 ? hs[i]! : KTM_ELEV;
          return new C.GeometryInstance({ geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(f.ring.flat())), height: h + 0.4 + Math.min(f.d, 6), vertexFormat: C.EllipsoidSurfaceAppearance.VERTEX_FORMAT }) });
        });
        prim = v.scene.primitives.add(new C.Primitive({
          geometryInstances: instances, asynchronous: false,
          appearance: new C.EllipsoidSurfaceAppearance({
            aboveGround: true, translucent: true,
            material: C.Material.fromType("Water", { baseWaterColor: new C.Color(0.1, 0.36, 0.6, 0.8), blendColor: new C.Color(0.04, 0.2, 0.35, 0.7), normalMap: BASE + "Assets/Textures/waterNormals.jpg", frequency: 700, animationSpeed: 0.02, amplitude: 0.7, specularIntensity: 0.7 }),
          }),
        }));
      } catch { /* water is decorative; keep the view if it cannot be drawn */ }
    })();
    return () => { dead = true; try { if (prim && !v.isDestroyed()) v.scene.primitives.remove(prim); } catch { /* ignore */ } };
  }, [state, ran, selected, showWater, depths]);

  const submit = () => { const t = draft.trim(); if (!t) return; try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } setToken(t); };
  return (
    <div className="photo">
      <div ref={box} className="photo-box" />
      {!token && (
        <div className="photo-card">
          <h3>Photoreal 3D needs a free Cesium ion token</h3>
          <p>Create one at <a href="https://ion.cesium.com/tokens" target="_blank" rel="noreferrer">ion.cesium.com/tokens</a> and add the Google Photorealistic 3D Tiles asset (ID {GOOGLE_ASSET}) to your account first. The token stays in this browser only.</p>
          <div className="photo-row"><input aria-label="Cesium ion token" type="password" placeholder="Paste token" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} /><button onClick={submit}>Load</button></div>
        </div>
      )}
      {state === "error" && (
        <div className="photo-card"><h3>Photoreal view could not start</h3><p>{msg}</p>
          <div className="photo-row"><button onClick={() => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } setToken(""); setState("idle"); }}>Use a different token</button></div></div>
      )}
      <div className="photo-bar">
        <span>{token && state !== "error" ? (streamed ? "Photoreal" : "Streaming photoreal tiles, this takes a few seconds…") : "Photoreal"} · {selected.name}</span>
        {ran && <label className="check"><input type="checkbox" checked={showWater} onChange={(e) => setShowWater(e.target.checked)} /> Flood water</label>}
        {linked.length > 0 && <label className="check"><input type="checkbox" checked={showLinked} onChange={(e) => setShowLinked(e.target.checked)} /> Show linked resources</label>}
        <button onClick={onClose}>Back to map</button>
      </div>
    </div>
  );
}
