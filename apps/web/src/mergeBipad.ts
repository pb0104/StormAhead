/**
 * Prefer BIPAD real/modelled facility layers over OSM/mock scene entities.
 * Keeps closures, pockets, towers, outages, radio, food, helipads from the adapter scene. Social posts are real (Reddit).
 */
import type { Action, Entity, Feature, FeatureCollection, Kind, Reason, SceneSnapshot } from "../../../packages/ports/index.ts";
import {
  AIRPORTS, ALERTS, ARMY, GAUGES, HOSPITALS, LANDSLIDES, RAIN_CELLS, RESPONDERS, SCHOOLS, SHELTERS,
} from "./real/ops.ts";
import { SOCIAL_ENTITIES } from "./real/social.ts";
import { bipadAdvice } from "./bipadAdvice.ts";

const REPLACE = new Set<Kind>(["hospital", "school", "landslide", "alert", "dam", "shelter", "qrt", "army", "airport", "social"]);

const BIPAD: Entity[] = [...HOSPITALS, ...SCHOOLS, ...SHELTERS, ...RESPONDERS, ...ARMY, ...AIRPORTS, ...ALERTS, ...GAUGES, ...LANDSLIDES, ...SOCIAL_ENTITIES];

function pointFeat(e: Entity): Feature {
  return {
    type: "Feature",
    geometry: e.geom.type === "Point" ? e.geom : { type: "Point", coordinates: e.at },
    properties: {
      id: e.id, kind: e.kind, name: e.name, stage: e.stage ?? 0,
      order: (e.props.order as number) ?? 0,
      access: (e.props.access as string) ?? "",
      risk: (e.props.risk as string) ?? "",
      status: (e.props.status as string) ?? "",
    },
  };
}

function polyFeat(e: Entity): Feature {
  return {
    type: "Feature",
    geometry: e.geom,
    properties: { id: e.id, kind: e.kind, name: e.name },
  };
}

export function mergeBipadIntoScene(scene: SceneSnapshot): SceneSnapshot {
  const kept = scene.entities.filter((e) => !REPLACE.has(e.kind)).map((e) => {
    if (e.props.prov) return e;
    const simulated = e.kind === "tower" || e.kind === "outage" || e.kind === "radio" || e.kind === "food";
    const modelled = e.kind === "closure" || e.kind === "pocket";
    return { ...e, props: { ...e.props, prov: simulated ? "simulated" : modelled ? "modelled" : (e.props.prov ?? "simulated") } };
  });
  const entities = [...kept, ...BIPAD];
  const points = entities.filter((e) => e.geom.type === "Point");
  const zoneKinds = new Set(["landslide", "outage", "alert"]);
  const zones: FeatureCollection = {
    type: "FeatureCollection",
    features: entities.filter((e) => zoneKinds.has(e.kind) && e.geom.type === "Polygon").map(polyFeat),
  };
  const advice: Record<string, { reasons: Reason[]; actions: Action[] }> = { ...scene.advice };
  for (const e of BIPAD) advice[e.id] = bipadAdvice(e, entities);
  // Refresh advice for kept simulated/modelled entities that reference BIPAD responders/shelters.
  for (const e of kept) {
    if (e.kind === "closure" || e.kind === "pocket" || e.kind === "tower" || e.kind === "outage" || e.kind === "social" || e.kind === "radio" || e.kind === "food" || e.kind === "helipad") {
      advice[e.id] = bipadAdvice(e, entities);
    }
  }
  const kindLabel = {
    ...scene.kindLabel,
    alert: "Official alert",
    dam: "River gauge",
    shelter: "Open space (IOM)",
    qrt: "Responder base",
    army: "Army site",
    airport: "Airport",
  };
  return {
    ...scene,
    note: "Facilities, alerts, gauges and social posts are real (BIPAD/DHM, Reddit); status is modelled under the observed flood. Towers, outages, radio and food depots are simulated.",
    entities,
    kindLabel,
    advice,
    geo: {
      ...scene.geo,
      points: { type: "FeatureCollection", features: points.map(pointFeat) },
      zones,
      rain: RAIN_CELLS as FeatureCollection,
    },
  };
}
