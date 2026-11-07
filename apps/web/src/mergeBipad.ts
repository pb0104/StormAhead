/**
 * Prefer BIPAD real/modelled facility layers over OSM/mock scene entities.
 * Also swaps mock towers/outages for Aesha's OpenCelliD + Black Marble layers.
 * Keeps closures, pockets, radio, food, helipads from the adapter scene. Social posts are real (Reddit, src/real/social.ts).
 */
import type { Action, Entity, Feature, FeatureCollection, Kind, Reason, SceneSnapshot } from "../../../packages/ports/index.ts";
import {
  AIRPORTS, ALERTS, ARMY, CARE_HOMES, FOOD_DEPOTS, FOOD_SHOPS, GAUGES, GOOGLE_RESPONDERS, HOSPITALS, LANDSLIDES, RAIN_CELLS, RESPONDERS, SCHOOLS, SHELTERS,
} from "./real/ops.ts";
import { CELL_SITES, cellStatus, DARK_AREAS } from "./realdata.ts";
import { SOCIAL_ENTITIES } from "./real/social.ts";
import { bipadAdvice } from "./bipadAdvice.ts";

const REPLACE = new Set<Kind>(["hospital", "school", "landslide", "alert", "dam", "shelter", "qrt", "army", "airport", "tower", "outage", "food", "social"]);

const CELL_TOWERS: Entity[] = CELL_SITES.map((s) => ({
  kind: "tower" as const,
  id: s.id,
  name: `Cell site ${s.id} · ${s.operators.join(", ")}`,
  at: [s.lon, s.lat] as [number, number],
  props: {
    status: cellStatus(s),
    cells: s.cells,
    radios: s.radios.join(", "),
    operators: s.operators.join(", "),
    samples: s.samples,
    firstSeen: s.firstSeen,
    preEvent: s.preEvent,
    distFloodM: s.distFloodM,
    prov: "cellModelled",
  },
  geom: { type: "Point" as const, coordinates: [s.lon, s.lat] as [number, number] },
}));

const NIGHT_OUTAGES: Entity[] = DARK_AREAS.map((a) => ({
  kind: "outage" as const,
  id: a.id,
  name: a.name,
  at: [a.lon, a.lat] as [number, number],
  props: { cells: a.cells, areaKm2: a.areaKm2, medianRatio: a.medianRatio, prov: "nightLights" },
  geom: { type: "Polygon" as const, coordinates: [a.ring] },
}));

const BIPAD: Entity[] = [...HOSPITALS, ...SCHOOLS, ...SHELTERS, ...CARE_HOMES, ...FOOD_DEPOTS, ...FOOD_SHOPS, ...RESPONDERS, ...GOOGLE_RESPONDERS, ...ARMY, ...AIRPORTS, ...ALERTS, ...GAUGES, ...LANDSLIDES, ...SOCIAL_ENTITIES, ...CELL_TOWERS, ...NIGHT_OUTAGES];

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
    const simulated = e.kind === "radio";
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
    if (e.kind === "closure" || e.kind === "pocket" || e.kind === "social" || e.kind === "radio" || e.kind === "food" || e.kind === "helipad") {
      advice[e.id] = bipadAdvice(e, entities);
    }
  }
  const kindLabel = {
    ...scene.kindLabel,
    alert: "Official alert",
    dam: "River gauge",
    shelter: "Shelter / care home",
    food: "Food shop / depot",
    qrt: "Responder base",
    army: "Army site",
    airport: "Airport",
    tower: "Cell site",
    outage: "Night-lights outage",
  };
  return {
    ...scene,
    note: "Facilities, alerts and gauges are real (BIPAD/DHM); care homes, fire/police and food shops from Google Places; cell sites modelled; outages are NASA night lights. Social posts are real (Reddit). Radio and depot stock are simulated.",
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
