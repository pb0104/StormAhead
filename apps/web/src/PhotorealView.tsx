import { useEffect, useRef, useState } from "react";
import type { Entity, FloodPoly } from "../../../packages/ports/index.ts";
import { TILE } from "./api.ts";
import { iconDataUrl, RING, type BuildingKind } from "./icons.ts";

/**
 * Photoreal close-up of ONE selected item: CesiumJS plus Google Photorealistic 3D Tiles through Cesium ion (free ion token).
 * Opened from the drawer's "View in photoreal". Only the selected item and the resources it links to are drawn.
 * Cesium loads from a CDN only when this view opens, so the default console has no extra dependency.
 */
declare global { interface Window { Cesium?: any; CESIUM_BASE_URL?: string } }
const V = "1.147.0", BASE = `https://cdn.jsdelivr.net/npm/cesium@${V}/Build/Cesium/`, GOOGLE_ASSET = 2275207, KTM_ELEV = 1300;
const BUILDING = new Set(["hospital", "school", "shelter", "food", "qrt", "airport", "helipad", "army"]);

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

const ringFor = (e: Entity, ran: boolean) => !ran ? RING.none : (e.kind === "hospital" || e.kind === "airport" || e.kind === "helipad" || e.kind === "army" ? (RING as Record<string, string>)[String(e.props.access)] : e.kind === "school" ? (RING as Record<string, string>)[String(e.props.risk)] : RING.base) ?? RING.none;
const COLOR: Record<string, string> = { closure: "#FF4A3D", pocket: "#FFB020", landslide: "#FF7A1A", outage: "#FFD23F", alert: "#3DD6E0", dam: "#7CC4FF" };
const geoPts = (e: Entity): [number, number][] => e.geom.type === "Point" ? [e.geom.coordinates] : ((e.geom.coordinates as unknown[]).flat(1) as [number, number][]);

function frameSelected(v: any, C: any, selected: Entity, height = KTM_ELEV) {
  const pts = geoPts(selected);
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const range = selected.kind === "dam" || selected.kind === "tower" ? 380 : Math.max(520, 600);
  // lookAt keeps the transform locked to the site: left-drag orbits, scroll zooms. No per-frame camera writes.
  v.camera.lookAt(
    C.Cartesian3.fromDegrees(cx, cy, height),
    new C.HeadingPitchRange(C.Math.toRadians(35), C.Math.toRadians(-28), range),
  );
  return { lon: cx, lat: cy, height, range };
}

export function PhotorealView({ token, setToken, ran, selected, linked, depths, floodPolys, entities, onClose }: {
  token: string; setToken: (t: string) => void; ran: boolean; selected: Entity; linked: string[]; depths: number[];
  floodPolys: FloodPoly[]; entities: Entity[]; onClose: () => void;
}) {
  const BY_ID = new Map(entities.map((e) => [e.id, e]));
  const FLOOD_POLYS = floodPolys;
  const box = useRef<HTMLDivElement>(null), viewer = useRef<any>(null);
  const targetRef = useRef<{ lon: number; lat: number; height: number; range: number } | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [streamed, setStreamed] = useState(false);
  const [msg, setMsg] = useState(""), [draft, setDraft] = useState("");
  const [showLinked, setShowLinked] = useState(true);
  const [showWater, setShowWater] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);

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
        // Route ion / tile HTTP through our disk-cached proxy so photoreal tiles are fetched once.
        const origFetch = C.Resource.prototype.fetch;
        C.Resource.prototype.fetch = function (this: any, options?: any) {
          try {
            const u = typeof this.url === "string" ? this.url : String(this.url ?? "");
            if (/^https?:\/\/(api\.cesium\.com|tile\.googleapis\.com|.*\.googleapis\.com)/i.test(u)) {
              this.url = TILE.cesiumProxy(u);
            }
          } catch { /* keep original url */ }
          return origFetch.call(this, options);
        };
        const v = new C.Viewer(box.current, {
          baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
          navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
          infoBox: false, selectionIndicator: false, shouldAnimate: true,
          // Default imagery + globe z-fight with Google photoreal tiles (black tears). Use a flat backdrop.
          baseLayer: false,
        });
        viewer.current = v;
        v.scene.globe.show = false;
        v.scene.backgroundColor = C.Color.fromCssColorString("#0A1217");
        v.scene.skyAtmosphere.show = false;
        v.scene.fog.enabled = false;
        v.scene.globe.depthTestAgainstTerrain = false;
        const ctrl = v.scene.screenSpaceCameraController;
        ctrl.enableRotate = true;
        ctrl.enableTranslate = false; // lookAt orbit mode: drag = rotate around the site
        ctrl.enableZoom = true;
        ctrl.enableTilt = true;
        ctrl.enableLook = false;
        ctrl.minimumZoomDistance = 80;
        ctrl.maximumZoomDistance = 15000;
        ctrl.inertiaSpin = 0.8;
        ctrl.inertiaZoom = 0.7;

        const tiles = await C.Cesium3DTileset.fromIonAssetId(GOOGLE_ASSET);
        if (dead) { v.destroy(); return; }
        tiles.maximumScreenSpaceError = 8;
        v.scene.primitives.add(tiles);
        tiles.initialTilesLoaded.addEventListener(() => setStreamed(true));
        tiles.allTilesLoaded.addEventListener(() => setStreamed(true));
        targetRef.current = frameSelected(v, C, selected);
        setState("ready");
      } catch (e) { if (!dead) { setMsg((e as Error).message || "Could not start the photoreal view."); setState("error"); } }
    })();
    return () => { dead = true; try { viewer.current?.destroy(); } catch { /* ignore */ } viewer.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Reframe when the selected feature changes while the viewer is open.
  useEffect(() => {
    const v = viewer.current, C = window.Cesium;
    if (state !== "ready" || !v || !C) return;
    targetRef.current = frameSelected(v, C, selected);
  }, [state, selected.id]);

  // Optional auto-orbit. Off by default so left-drag is always free for manual rotate.
  useEffect(() => {
    const v = viewer.current, C = window.Cesium;
    if (state !== "ready" || !v || !C || !autoRotate) return;
    let dragging = false;
    const onDown = () => { dragging = true; };
    const onUp = () => { dragging = false; };
    const canvas = v.scene.canvas as HTMLCanvasElement;
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    const remove = v.clock.onTick.addEventListener(() => {
      if (dragging || v.isDestroyed()) return;
      const o = targetRef.current;
      if (!o) return;
      const target = C.Cartesian3.fromDegrees(o.lon, o.lat, o.height);
      const heading = v.camera.heading + C.Math.toRadians(0.08);
      const pitch = C.Math.clamp(v.camera.pitch, C.Math.toRadians(-80), C.Math.toRadians(-10));
      const range = Math.max(120, C.Cartesian3.distance(v.camera.positionWC, target));
      o.range = range;
      v.camera.lookAt(target, new C.HeadingPitchRange(heading, pitch, range));
    });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      remove();
      // Re-lock lookAt so manual drag orbit still works after auto-rotate stops.
      const o = targetRef.current;
      if (o && !v.isDestroyed()) {
        v.camera.lookAt(
          C.Cartesian3.fromDegrees(o.lon, o.lat, o.height),
          new C.HeadingPitchRange(v.camera.heading, v.camera.pitch, o.range),
        );
      }
    };
  }, [state, autoRotate, selected.id]);

  // Draw the selected item, and optionally the resources it links to.
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
        const pos = C.Cartesian3.fromDegrees(lon, lat, h + (e.kind === "dam" ? 18 : 6)), id = `${tag}:${e.id}`;
        if (BUILDING.has(e.kind)) {
          const badge = ran && (e.props.risk === "risk" || e.props.risk === "high" || e.props.access === "degraded" || e.props.access === "lost");
          v.entities.add({ id, position: pos, billboard: { image: iconDataUrl(e.kind as BuildingKind, ringFor(e, ran), badge), scale: main ? 0.8 : 0.6, disableDepthTestDistance: Number.POSITIVE_INFINITY, verticalOrigin: C.VerticalOrigin.BOTTOM } });
        } else if (e.kind === "dam") {
          v.entities.add({
            id,
            position: pos,
            point: {
              pixelSize: main ? 22 : 14,
              color: C.Color.fromCssColorString("#7CC4FF"),
              outlineColor: C.Color.WHITE,
              outlineWidth: 3,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: e.name,
              font: "700 14px sans-serif",
              fillColor: C.Color.WHITE,
              outlineColor: C.Color.fromCssColorString("#0B1318"),
              outlineWidth: 4,
              style: C.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: C.VerticalOrigin.BOTTOM,
              pixelOffset: new C.Cartesian2(0, -28),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              showBackground: true,
              backgroundColor: C.Color.fromCssColorString("#0B1318").withAlpha(0.72),
            },
          });
        } else {
          v.entities.add({ id, position: pos, point: { pixelSize: main ? 14 : 10, color: C.Color.WHITE, outlineColor: C.Color.fromCssColorString("#0B1318"), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
        }
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
        {token && state === "ready" && (
          <label className="check" title="Drag on the view to rotate manually. Check this to keep spinning.">
            <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} /> Auto-rotate
          </label>
        )}
        {ran && <label className="check"><input type="checkbox" checked={showWater} onChange={(e) => setShowWater(e.target.checked)} /> Flood water</label>}
        {linked.length > 0 && <label className="check"><input type="checkbox" checked={showLinked} onChange={(e) => setShowLinked(e.target.checked)} /> Show linked resources</label>}
        <button onClick={onClose}>Back to map</button>
      </div>
    </div>
  );
}
