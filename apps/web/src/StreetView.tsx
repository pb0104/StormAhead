import { useEffect, useRef, useState } from "react";
import type { Entity } from "../../../packages/ports/index.ts";

/**
 * Street View overlay for the selected site. Covers the MapLibre map (Google Maps
 * Platform ToS: Street View must not share the screen with a non-Google map).
 * Needs VITE_GOOGLE_MAPS_API_KEY with Maps JavaScript API + Street View Static enabled.
 */
declare global {
  interface Window {
    google?: any;
    gm_authFailure?: () => void;
  }
}

const KEY = () => ((import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || "";

let mapsLoading: Promise<any> | null = null;
function loadMaps(key: string): Promise<any> {
  if (window.google?.maps?.StreetViewPanorama) return Promise.resolve(window.google.maps);
  if (mapsLoading) return mapsLoading;
  mapsLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    s.async = true;
    s.onload = () => resolve(window.google!.maps);
    s.onerror = () => { mapsLoading = null; reject(new Error("Could not load Google Maps JavaScript API")); };
    document.head.appendChild(s);
  });
  return mapsLoading;
}

export function StreetView({ selected, onClose }: { selected: Entity; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const key = KEY();

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!key || !box.current) return;
    let dead = false;
    let pan: any = null;
    setState("loading");
    setMsg("");
    setDate(null);
    (async () => {
      try {
        window.gm_authFailure = () => {
          if (!dead) { setState("error"); setMsg("Google rejected the Maps API key (enable Maps JavaScript API, check billing, or referrer restrictions)."); }
        };
        const maps = await loadMaps(key);
        if (dead || !box.current) return;
        const loc = { lat: selected.at[1], lng: selected.at[0] };
        const svc = new maps.StreetViewService();
        const data: any = await new Promise((resolve, reject) => {
          svc.getPanorama({ location: loc, radius: 80, source: maps.StreetViewSource.OUTDOOR }, (res: any, status: string) => {
            if (status === "OK") resolve(res);
            else if (status === "ZERO_RESULTS") resolve(null);
            else reject(new Error(`Street View lookup failed: ${status}`));
          });
        });
        if (dead || !box.current) return;
        if (!data) { setState("empty"); return; }
        const heading = data.tiles?.centerHeading ?? 0;
        pan = new maps.StreetViewPanorama(box.current, {
          position: data.location.latLng,
          pov: { heading, pitch: 0 },
          zoom: 1,
          addressControl: true,
          linksControl: true,
          panControl: true,
          enableCloseButton: false,
          fullscreenControl: false,
          motionTracking: false,
          showRoadLabels: true,
        });
        const rawDate = data.imageDate || null;
        setDate(rawDate);
        setState("ready");
      } catch (e) {
        if (!dead) { setState("error"); setMsg((e as Error).message || "Street View failed"); }
      }
    })();
    return () => {
      dead = true;
      try { pan?.setVisible?.(false); } catch { /* ignore */ }
    };
  }, [key, selected.id, selected.at[0], selected.at[1]]);

  return (
    <div className="photo streetview" role="dialog" aria-label={`Street View · ${selected.name}`}>
      <div ref={box} className="photo-box" />
      {!key && (
        <div className="photo-card">
          <h3>Street View needs a Google Maps API key</h3>
          <p>Set <code>VITE_GOOGLE_MAPS_API_KEY</code> in <code>apps/web/.env.local</code> (Maps JavaScript API enabled). This overlay covers the ops map so Street View is not shown beside MapLibre.</p>
        </div>
      )}
      {key && state === "error" && (
        <div className="photo-card"><h3>Street View could not start</h3><p>{msg}</p></div>
      )}
      {key && state === "empty" && (
        <div className="photo-card">
          <h3>No outdoor Street View here</h3>
          <p>Google has no outdoor panorama within ~80 m of {selected.name}.</p>
        </div>
      )}
      <div className="photo-bar">
        <span>
          {state === "loading" ? "Looking up Street View…" : "Street View"}
          {" · "}{selected.name}
          {date ? ` · ${date}` : ""}
          {" · © Google"}
        </span>
        <button type="button" onClick={onClose}>Back to map</button>
      </div>
    </div>
  );
}
