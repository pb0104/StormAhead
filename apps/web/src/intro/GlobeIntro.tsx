import { useEffect, useRef, useState } from "react";
import { maplibregl } from "../mapsetup.ts";
import "./intro.css";

// ---- Tunables (ms unless noted) -------------------------------------------------------------
const SPIN_FORWARD_MS = 1100;   // globe appears and turns the normal (eastward) way
const REWIND_MS = 5000;         // reverse spin + clock rewind (accelerates, then brakes)
const FLY_MS = 3600;            // fly-in from the globe to the Kathmandu valley
const FADE_MS = 900;            // HUD + overlay fade out, revealing the console
const SPIN_FORWARD_DEG_PER_S = 14;
const REVERSE_TURNS = 2;        // full reverse rotations during the rewind
const START_LON = 20;           // where the globe opens
const START_LAT = 14;
const START_ZOOM = 1.15;
const REWIND_END_ZOOM = 2.1;
const TARGET: [number, number] = [85.3, 27.7];            // Kathmandu lock
const LANDING = { center: [85.3885, 27.6875] as [number, number], zoom: 10.6 }; // ≈ console's fit to the valley bbox
const CLOCK_END = Date.UTC(2024, 8, 26, 0, 15);           // 26 Sep 2024 06:00 NPT (UTC+5:45), the replay clock
const NPT_OFFSET_MS = (5 * 60 + 45) * 60_000;
const SEEN_KEY = "stormahead.intro.seen";
// ----------------------------------------------------------------------------------------------

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // in-out cubic
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function fmtClock(utcMs: number) {
  const d = new Date(utcMs + NPT_OFFSET_MS);
  return {
    date: `${pad(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
  };
}
const fmtLat = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "N" : "S"}`;
const fmtLon = (v: number) => { const w = ((v + 540) % 360) - 180; return `${Math.abs(w).toFixed(2)}°${w >= 0 ? "E" : "W"}`; };

export function introEnabled(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get("intro");
    if (q === "0") return false;
    if (q === "1") return true;
  } catch { /* ignore */ }
  try { if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false; } catch { /* ignore */ }
  try { return sessionStorage.getItem(SEEN_KEY) !== "1"; } catch { return true; }
}
const markSeen = () => { try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* ignore */ } };

function graticule() {
  const f: unknown[] = [];
  for (let lon = -180; lon < 180; lon += 15) f.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 37 }, (_, i) => [lon, -90 + i * 5]) } });
  for (let lat = -75; lat <= 75; lat += 15) f.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]) } });
  return { type: "FeatureCollection" as const, features: f } as never;
}

type Phase = "spin" | "rewind" | "fly" | "fade";

function Intro({ onDone }: { onDone: () => void }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const starEl = useRef<HTMLCanvasElement>(null);
  const hud = useRef({ date: null as HTMLElement | null, time: null as HTMLElement | null, lat: null as HTMLElement | null, lon: null as HTMLElement | null, bar: null as HTMLElement | null });
  const [phase, setPhase] = useState<Phase>("spin");
  const [noGl, setNoGl] = useState(false);
  const skip = useRef<() => void>(() => {});
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false, raf = 0, finished = false, flyStarted = false;
    const timers: number[] = [];
    // Starfield (drawn once)
    const cv = starEl.current;
    if (cv) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = window.innerWidth * dpr; cv.height = window.innerHeight * dpr;
      const g = cv.getContext("2d");
      if (g) {
        for (let i = 0; i < 260; i++) {
          const r = Math.random() * 1.2 * dpr + 0.2, a = 0.25 + Math.random() * 0.7;
          g.fillStyle = Math.random() < 0.12 ? `rgba(255,214,150,${a})` : `rgba(190,225,255,${a})`;
          g.beginPath(); g.arc(Math.random() * cv.width, Math.random() * cv.height, r, 0, 7); g.fill();
        }
      }
    }

    let m: maplibregl.Map | null = null;
    try {
      m = new maplibregl.Map({
        container: mapEl.current!, attributionControl: false, interactive: false, fadeDuration: 0,
        center: [START_LON, START_LAT], zoom: START_ZOOM, pitch: 0, canvasContextAttributes: { antialias: true },
        style: {
          version: 8,
          projection: { type: "globe" },
          sky: { "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0], "sky-color": "#1d6fb8", "horizon-color": "#7fd1ff", "fog-color": "#0a1a2b", "sky-horizon-blend": 0.6 },
          sources: {
            grat: { type: "geojson", data: graticule() },
            esri: { type: "raster", tiles: ["/api/tiles/esri/{z}/{y}/{x}"], tileSize: 256, maxzoom: 18 },
          },
          layers: [
            { id: "bg", type: "background", paint: { "background-color": "#06121c" } },
            { id: "sat", type: "raster", source: "esri", paint: { "raster-opacity": 0.92, "raster-brightness-max": 0.78, "raster-saturation": -0.25, "raster-contrast": 0.1, "raster-fade-duration": 300 } },
            { id: "grat", type: "line", source: "grat", paint: { "line-color": "#5fe3ff", "line-opacity": 0.22, "line-width": 0.6 } },
          ],
        } as maplibregl.StyleSpecification,
      });
    } catch { m = null; setNoGl(true); } // WebGL unavailable (e.g. hardware acceleration off): HUD-only version, still plays
    m?.on("error", () => { /* tile errors are expected offline; graticule fallback stays */ });
    const mm = m;

    // Target-lock marker, shown while flying in
    const lockEl = document.createElement("div");
    lockEl.innerHTML = `<div class="gi-lock"><i></i><span>LOCK · 27.70°N 85.30°E · KATHMANDU</span></div>`; // inner node: MapLibre owns the marker element's opacity on a globe
    if (mm) new maplibregl.Marker({ element: lockEl, anchor: "center" }).setLngLat(TARGET).addTo(mm);

    function setHud(lon: number, lat: number, clock: number, pct: number) {
      const h = hud.current, c = fmtClock(clock);
      if (h.date) h.date.textContent = c.date;
      if (h.time) h.time.textContent = c.time;
      if (h.lat) h.lat.textContent = fmtLat(lat);
      if (h.lon) h.lon.textContent = fmtLon(lon);
      if (h.bar) h.bar.style.transform = `scaleX(${pct})`;
      if (cv) cv.style.transform = `translateX(${(-lon * 1.4) % 400}px)`;
    }

    function finish() {
      if (finished) return;
      finished = true; markSeen();
      setPhase("fade");
      timers.push(window.setTimeout(() => { if (!dead) onDone(); }, FADE_MS));
    }
    skip.current = () => { cancelAnimationFrame(raf); finish(); };

    const t0 = performance.now();
    const NOW = Date.now();
    let lastT = t0, lon = START_LON;
    const rewindLonSpan = REVERSE_TURNS * 360;

    const tick = (now: number) => {
      if (dead || finished) return;
      const t = now - t0;
      const lat0 = mm ? mm.getCenter().lat : START_LAT;
      if (t < SPIN_FORWARD_MS) {
        const dt = (now - lastT) / 1000;
        lon -= SPIN_FORWARD_DEG_PER_S * dt;   // Earth turns eastward: surface drifts left→right, view centre moves west
        mm?.jumpTo({ center: [lon, START_LAT], zoom: START_ZOOM });
        setHud(lon, lat0, NOW, 0);
      } else if (t < SPIN_FORWARD_MS + REWIND_MS) {
        if (phaseRef.cur !== "rewind") { phaseRef.cur = "rewind"; setPhase("rewind"); phaseRef.lon = lon; }
        const k = (t - SPIN_FORWARD_MS) / REWIND_MS, e = ease(k);
        // end exactly on the target meridian after REVERSE_TURNS full turns the "wrong" way (eastward view drift reversed)
        const endLon = TARGET[0] + 360 * 0; // modulo handled below
        const delta = ((endLon - phaseRef.lon) % 360 + 360) % 360;
        const curLon = phaseRef.lon + e * (rewindLonSpan + delta);
        const curLat = START_LAT + (TARGET[1] - START_LAT) * e;
        const zoom = START_ZOOM + (REWIND_END_ZOOM - START_ZOOM) * e;
        mm?.jumpTo({ center: [((curLon + 540) % 360) - 180, curLat], zoom });
        const clock = NOW + (CLOCK_END - NOW) * Math.pow(e, 1.15);
        setHud(curLon, curLat, clock, e);
      } else {
        if (!flyStarted) {
          flyStarted = true; setPhase("fly");
          lockEl.firstElementChild?.classList.add("on");
          if (mm) {
            mm.flyTo({ center: LANDING.center, zoom: LANDING.zoom, pitch: 0, bearing: 0, duration: FLY_MS, curve: 1.5, essential: true });
            mm.once("moveend", () => { cancelAnimationFrame(raf); finish(); });
          }
          timers.push(window.setTimeout(finish, FLY_MS + (mm ? 1500 : 0))); // safety net / no-WebGL path
        }
        const c = mm ? mm.getCenter() : { lng: TARGET[0], lat: TARGET[1] };
        setHud(c.lng, c.lat, CLOCK_END, 1);
      }
      lastT = now;
      raf = requestAnimationFrame(tick);
    };
    const phaseRef = { cur: "spin" as Phase, lon: lon };
    raf = requestAnimationFrame(tick);

    return () => { dead = true; cancelAnimationFrame(raf); timers.forEach(clearTimeout); try { mm?.remove(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const k = () => skip.current();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const r = (k: keyof typeof hud.current) => (el: HTMLElement | null) => { hud.current[k] = el; };
  return (
    <div ref={root} className={`gi gi-${phase}`} onClick={() => skip.current()} role="presentation">
      <canvas ref={starEl} className="gi-stars" aria-hidden="true" />
      <div ref={mapEl} className="gi-map" aria-hidden="true" />
      {noGl && <div className="gi-orb" aria-hidden="true" />}
      <div className="gi-scan" aria-hidden="true" />
      <div className="gi-vig" aria-hidden="true" />
      <div className="gi-hud" aria-hidden="true">
        <div className="gi-tl">
          <div className="gi-tag"><i /> {phase === "spin" ? "ORBITAL VIEW" : phase === "rewind" ? "REWINDING" : "TEMPORAL LOCK"}</div>
          <div className="gi-date" ref={r("date")}>--</div>
          <div className="gi-time" ref={r("time")}>--:--:--</div>
          <div className="gi-sub">NPT · UTC+05:45</div>
        </div>
        <div className="gi-tr">
          <div><b>LAT</b> <span ref={r("lat")}>--</span></div>
          <div><b>LON</b> <span ref={r("lon")}>--</span></div>
          <div className="gi-dim">TARGET 27.70°N 85.30°E</div>
        </div>
        <div className="gi-bl">
          <div className="gi-dim">DESTINATION</div>
          <div className="gi-dest">26 SEP 2024 · 06:00 NPT · KATHMANDU VALLEY</div>
          <div className="gi-track"><i ref={r("bar")} /></div>
        </div>
        <i className="gi-c gi-c1" /><i className="gi-c gi-c2" /><i className="gi-c gi-c3" /><i className="gi-c gi-c4" />
      </div>
      <button className="gi-skip" onClick={(e) => { e.stopPropagation(); skip.current(); }}>Skip intro <kbd>any key</kbd></button>
    </div>
  );
}

/** Plays the intro on top of the console (which loads underneath), then unmounts. Includes a small replay button. */
export function IntroGate() {
  const [playing, setPlaying] = useState(() => introEnabled());
  const [run, setRun] = useState(0);
  return (
    <>
      {playing && <Intro key={run} onDone={() => setPlaying(false)} />}
      {!playing && (
        <button className="gi-replay" title="Replay the globe intro" onClick={() => { setRun((n) => n + 1); setPlaying(true); }}>↺ Intro</button>
      )}
    </>
  );
}
