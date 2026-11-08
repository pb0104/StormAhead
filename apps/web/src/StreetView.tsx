import { useEffect, useRef, useState } from "react";
/** Anything with a name and a place: a map entity, an alert pin, a social post, a combined finding. */
export type StreetTarget = { id: string; name: string; at: [number, number] };
const haversineM = (a: { lat: number; lng: number }, b: { lat: () => number; lng: () => number }) => {
  const R = 6371000, r = Math.PI / 180, dLat = (b.lat() - a.lat) * r, dLng = (b.lng() - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat() * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

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

export function StreetView({ selected, onClose }: { selected: StreetTarget; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [dist, setDist] = useState<number | null>(null); // metres from the element to the panorama shown
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
    setDist(null);
    (async () => {
      try {
        window.gm_authFailure = () => {
          if (!dead) { setState("error"); setMsg("Google rejected the Maps API key (enable Maps JavaScript API, check billing, or referrer restrictions)."); }
        };
        const maps = await loadMaps(key);
        if (dead || !box.current) return;
        const loc = { lat: selected.at[1], lng: selected.at[0] };
        const svc = new maps.StreetViewService();
        // Widen the search: 50 m, 200 m, then 800 m (mountain areas are thinly covered); the bar says how far the panorama is.
        let data: any = null;
        for (const radius of [50, 200, 800]) {
          data = await new Promise((resolve, reject) => {
            svc.getPanorama({ location: loc, radius, source: maps.StreetViewSource.OUTDOOR }, (res: any, status: string) => {
              if (status === "OK") resolve(res);
              else if (status === "ZERO_RESULTS") resolve(null);
              else reject(new Error(`Street View lookup failed: ${status}`));
            });
          });
          if (data) break;
        }
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
        setDist(Math.round(haversineM(loc, data.location.latLng)));
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
          <p>Set <code>VITE_GOOGLE_MAPS_API_KEY</code> in the repo-root <code>.env</code> (Maps JavaScript API enabled), then restart the dev server. This overlay covers the ops map so Street View is not shown beside MapLibre.</p>
        </div>
      )}
      {key && state === "error" && (
        <div className="photo-card"><h3>Street View could not start</h3><p>{msg}</p></div>
      )}
      {key && state === "empty" && (
        <div className="photo-card">
          <h3>No Street View coverage near this point</h3>
          <p>Google has no outdoor panorama within 800 m of {selected.name}. This is common in mountain and rural areas.</p>
        </div>
      )}
      <div className="photo-bar">
        <span>
          {state === "loading" ? "Looking up Street View…" : "Street View"}
          {" · "}{selected.name}
          {dist !== null && dist > 30 ? ` · nearest coverage ${dist} m away` : ""}
          {date ? ` · ${date}` : ""}
          {" · © Google"}
        </span>
        <button type="button" onClick={onClose}>Back to map</button>
      </div>
    </div>
  );
}
