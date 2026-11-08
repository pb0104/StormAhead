import type {
  Action, AssetsSnapshot, Entity, Feature, Kind, OsmAsset, Reason, SceneSnapshot,
} from "../ports/index.ts";

const REAL_KINDS = new Set<Kind>(["hospital", "school", "dam", "airport", "helipad", "tower", "shelter"]);

function propsFor(a: OsmAsset): Entity["props"] {
  switch (a.kind) {
    case "hospital":
    case "airport":
    case "helipad":
      return { access: "ok", extraMin: 0, osm: a.id, source: "openstreetmap" };
    case "school":
      return { risk: "ok", students: 0, why: "", osm: a.id, source: "openstreetmap" };
    case "tower":
      return { status: "up", cause: "", osm: a.id, source: "openstreetmap" };
    case "dam":
      return { level: Number(a.tags.level) || 0, osm: a.id, source: "openstreetmap" };
    case "shelter":
      return { capacity: 0, occupied: 0, osm: a.id, source: "openstreetmap" };
    default:
      return { osm: a.id, source: "openstreetmap" };
  }
}

function toEntity(a: OsmAsset): Entity {
  return {
    kind: a.kind,
    id: a.id,
    name: a.name,
    at: a.at,
    props: propsFor(a),
    geom: a.geom.type === "Point" ? a.geom : { type: "Point", coordinates: a.at },
  };
}

function adviceFor(e: Entity, a: OsmAsset): { reasons: Reason[]; actions: Action[] } {
  const tagBits = Object.entries(a.tags)
    .filter(([k]) => !["source"].includes(k))
    .slice(0, 8)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  const reasons: Reason[] = [
    { input: "Name", text: e.name },
    { input: "OpenStreetMap", text: `Located at ${e.at[1].toFixed(5)}°N, ${e.at[0].toFixed(5)}°E (${a.osmType}/${a.osmId}).` },
    { input: "Tags", text: tagBits || `Mapped as ${a.kind}.` },
    { input: "Licence", text: "ODbL © OpenStreetMap contributors. Positions are crowd-mapped; completeness varies." },
  ];
  if (a.kind === "dam") {
    reasons.splice(1, 0, {
      input: "Dam",
      text: a.tags.name || a.tags["name:en"] || a.tags["name:ne"]
        ? `${e.name} is mapped in OpenStreetMap as a dam. Reservoir level / release schedule is not in OSM (reservoir level / release not in OSM).`
        : a.tags.derived_name
          ? `OSM has no name tag on this dam; labelled from nearby water “${a.tags.derived_name}”. Level / release not in OSM.`
          : "This dam has no name tag in OpenStreetMap; shown by coordinates until local naming is added.",
    });
  }
  return { reasons, actions: [] };
}

function pointFeature(e: Entity): Feature {
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

/** Replace scene hospital/school/dam/airport/tower/shelter entities with live OSM assets; keep other layers. */
export function mergeAssetsIntoScene(scene: SceneSnapshot, assets: AssetsSnapshot): SceneSnapshot {
  const real = assets.assets.map(toEntity);
  const kept = scene.entities.filter((e) => !REAL_KINDS.has(e.kind));
  const entities = [...kept, ...real];

  const advice = { ...scene.advice };
  for (const k of Object.keys(advice)) {
    const ent = scene.entities.find((e) => e.id === k);
    if (ent && REAL_KINDS.has(ent.kind)) delete advice[k];
  }
  assets.assets.forEach((a, i) => {
    advice[real[i]!.id] = adviceFor(real[i]!, a);
  });

  const mockPoints = scene.geo.points.features.filter((f) => !REAL_KINDS.has(String(f.properties.kind) as Kind));
  const points = {
    type: "FeatureCollection" as const,
    features: [...mockPoints, ...real.map(pointFeature)],
  };

  const note = `${scene.note} Critical sites (hospitals, schools, dams, airports, helipads, towers, shelters): ${assets.source} (${assets.licence}); ${real.length} features.`;

  return { ...scene, entities, geo: { ...scene.geo, points }, advice, note };
}
