import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

maplibregl.setWorkerUrl(workerUrl);
import type { Dataset, PlanningInputs, PlanEvaluation } from "../../../packages/shared/schemas.ts";
import type { ExposureResult } from "../../../packages/analysis/exposure.ts";

type Props = {
  dataset: Dataset;
  inputs: PlanningInputs;
  scenarioId: string;
  exposure: Record<string, ExposureResult> | null;
  evaluation: PlanEvaluation | null;
  onToggleRoad: (id: string) => void;
};

const ICON: Record<string, string> = { settlement: "●", hospital: "H", shelter: "S", crossing: "B", junction: "·", staging: "◆" };

export function MapView({ dataset, inputs, scenarioId, exposure, evaluation, onToggleRoad }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const ready = useRef(false);
  const toggleRef = useRef(onToggleRoad);
  toggleRef.current = onToggleRoad;

  const nodePos = (id: string) => dataset.assets.find((a) => a.id === id)!.position;

  // Init once. No external tiles: plain background + local GeoJSON.
  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#e9edf1" } }] },
      bounds: [[84.27, 27.665], [84.63, 27.79]],
      fitBoundsOptions: { padding: 40 },
      attributionControl: false,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      m.addSource("hazard", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addSource("roads", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "hazard-fill", type: "fill", source: "hazard", paint: { "fill-color": "#2f6fdb", "fill-opacity": 0.28 } });
      m.addLayer({ id: "hazard-line", type: "line", source: "hazard", paint: { "line-color": "#2f6fdb", "line-width": 1.5, "line-dasharray": [2, 2] } });
      m.addLayer({
        id: "roads", type: "line", source: "roads",
        paint: {
          "line-color": ["match", ["get", "status"], "closed", "#d92d20", "user", "#7a1fa2", "exposed", "#f79009", "#5b6b7c"],
          "line-width": ["match", ["get", "kind"], "bridge", 6, "track", 2, 3.5],
          "line-dasharray": ["match", ["get", "kind"], "track", ["literal", [2, 1.5]], ["literal", [1, 0]]],
        },
      });
      m.addLayer({ id: "roads-closed-x", type: "line", source: "roads", filter: ["in", ["get", "status"], ["literal", ["closed", "user"]]],
        paint: { "line-color": "#fff", "line-width": 1.5, "line-dasharray": [1, 3] } });
      m.addLayer({ id: "roads-hit", type: "line", source: "roads", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 16 } });
      m.on("click", "roads-hit", (e: maplibregl.MapLayerMouseEvent) => { const id = e.features?.[0]?.properties?.id; if (id) toggleRef.current(id); });
      m.on("mouseenter", "roads-hit", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "roads-hit", () => (m.getCanvas().style.cursor = ""));
      ready.current = true;
      (m as any).fire("cascade-ready");
    });
    map.current = m;
    return () => { markers.current.forEach((x) => x.remove()); m.remove(); ready.current = false; };
  }, []);

  // Update layers + markers whenever inputs change.
  useEffect(() => {
    const m = map.current!;
    const apply = () => {
      const h = dataset.hazards.find((x) => x.id === scenarioId)!;
      const exposed = new Set(exposure?.[scenarioId]?.exposedEdgeIds ?? []);
      const closed = new Set(h.closedEdgeIds);
      (m.getSource("hazard") as maplibregl.GeoJSONSource).setData({
        type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: h.footprint },
      } as any);
      (m.getSource("roads") as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: dataset.roads.map((r) => ({
          type: "Feature",
          properties: { id: r.id, kind: r.kind, name: r.name, status: inputs.extraClosureIds.includes(r.id) ? "user" : closed.has(r.id) ? "closed" : exposed.has(r.id) ? "exposed" : "open" },
          geometry: { type: "LineString", coordinates: [nodePos(r.from), ...r.via, nodePos(r.to)] },
        })),
      } as any);

      markers.current.forEach((x) => x.remove());
      markers.current = [];
      const sc = evaluation?.scenarios.find((s) => s.scenarioId === scenarioId);
      const problems = new Map<string, string[]>();
      for (const d of sc?.demands ?? []) {
        if (d.status === "covered") continue;
        const dem = dataset.demands.find((x) => x.id === d.demandId)!;
        const why = d.status === "late" ? `reachable in ${d.minutes} min (> ${inputs.thresholdMinutes})` : d.status === "unreachable" ? "UNREACHABLE" : "no compatible resource";
        problems.set(dem.nodeId, [...(problems.get(dem.nodeId) ?? []), `${dem.name}: ${why}`]);
      }
      const siteByNode = new Map(dataset.sites.map((s) => [s.nodeId, s]));
      for (const a of dataset.assets) {
        if (a.type === "junction") continue;
        const site = siteByNode.get(a.id);
        const div = document.createElement("div");
        const isExp = exposure?.[scenarioId]?.exposedAssetIds.includes(a.id);
        const bad = problems.get(a.id);
        div.className = `mk mk-${a.type}${isExp ? " exposed" : ""}${bad ? " bad" : ""}`;
        if (site) {
          const disabled = inputs.disabledSiteIds.includes(site.id);
          const inelig = h.siteEligibility[site.id]?.eligible === false;
          div.classList.toggle("disabled", disabled);
          div.classList.toggle("ineligible", inelig);
          const chips = (evaluation?.plan.placements ?? []).filter((p) => p.siteId === site.id)
            .map((p) => `<span class="chip chip-${p.resourceType}${evaluation && sc?.lostResourceIds.includes(p.resourceId) ? " lost" : ""}">${p.resourceId}</span>`).join("");
          div.innerHTML = `<div class="pin">◆</div><div class="lbl">${site.id} ${site.name}${disabled ? " (disabled)" : inelig ? " (ineligible here)" : ""}</div><div class="chips">${chips}</div>`;
        } else {
          div.innerHTML = `<div class="pin">${ICON[a.type]}</div><div class="lbl">${a.name.replace(" (simulated)", "")}</div>`;
        }
        if (bad) div.title = bad.join("\n");
        markers.current.push(new maplibregl.Marker({ element: div }).setLngLat(a.position).addTo(m));
      }
    };
    if (ready.current) apply(); else (m as any).once("cascade-ready", apply);
  }, [dataset, inputs, scenarioId, exposure, evaluation]);

  return <div ref={el} className="map" />;
}
