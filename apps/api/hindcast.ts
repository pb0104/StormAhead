import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { analyzeCascade, DEFAULT_PARAMS, DEFAULT_SCORE, scoreAgainstIncidents, type CascadeParams, type CascadeResult, type Incident, type RealArea, type ScoreResult } from "../../packages/analysis/cascade.ts";
import type { AgentEvent } from "../../packages/shared/events.ts";
import { HttpError } from "./common.ts";

export const KTM_DIR = fileURLToPath(new URL("../../data/real/kathmandu/", import.meta.url));
export const EVENT_START = "2024-09-27T00:00:00Z";

type Provenance = {
  area: string; bbox: number[];
  network: { source: string; snapshot: string; licence: string; phase: string; speedKmhByClass: Record<string, number>; assumptions: string[] };
  hazardInput: { source: string; observedOn: string; phase: string; licence: string };
  counts: Record<string, number>;
};

/** The road network must predate the event, otherwise the "pre-event" claim is false (temporal leak). */
export function assertNetworkPreEvent(p: Provenance) {
  if (Date.parse(p.network.snapshot) >= Date.parse(EVENT_START) || p.network.phase !== "pre-event")
    throw new HttpError(422, `Temporal separation violated: network snapshot ${p.network.snapshot} (${p.network.phase}) is not before the event (${EVENT_START}).`);
}

export class HindcastService {
  area: RealArea; floodGeo: unknown; incidents: Incident[]; prov: Provenance; incidentsMeta: Record<string, unknown>;
  private roadsGeo: unknown = null;

  constructor(dir = KTM_DIR) {
    this.prov = JSON.parse(readFileSync(dir + "provenance.json", "utf8"));
    assertNetworkPreEvent(this.prov);
    const net = JSON.parse(readFileSync(dir + "network.json", "utf8"));
    const pl = JSON.parse(readFileSync(dir + "places.json", "utf8"));
    this.area = {
      nodes: net.nodes,
      edges: net.edges.map((e: any[]) => ({ u: e[0], v: e[1], minutes: e[2], lengthM: e[3], cls: e[4], bridge: !!e[5], floodedShare: e[6], name: e[7], osmWayId: e[8], mid: e[9], distFloodM: e[10], via: e[11] })),
      places: pl.places, hospitals: pl.hospitals,
    };
    this.floodGeo = JSON.parse(readFileSync(dir + "flood_extent.geojson", "utf8"));
    const inc = JSON.parse(readFileSync(dir + "incidents.json", "utf8"));
    this.incidents = inc.incidents; this.incidentsMeta = { source: inc.source, window: inc.window, retrievedAt: inc.retrievedAt, note: inc.note, nationalIncidentsInWindow: inc.nationalIncidentsInWindow };
  }

  static available(dir = KTM_DIR) { return ["provenance", "network", "places", "flood_extent", "incidents"].every((f) => existsSync(dir + f + (f === "flood_extent" ? ".geojson" : ".json"))); }

  meta() {
    return { available: true, provenance: this.prov, incidents: this.incidentsMeta, evaluationIncidents: this.incidents.length, defaults: { params: DEFAULT_PARAMS, score: DEFAULT_SCORE } };
  }

  /** Static geometry for the map; cached. Edge index `i` is the key used by results. */
  geo() {
    this.roadsGeo ??= {
      type: "FeatureCollection",
      features: this.area.edges.map((e, i) => ({
        type: "Feature", properties: { i, c: e.cls, b: e.bridge ? 1 : 0, n: e.name },
        geometry: { type: "LineString", coordinates: [this.area.nodes[e.u], ...(e.via ?? []), this.area.nodes[e.v]] },
      })),
    };
    return {
      roads: this.roadsGeo, flood: this.floodGeo,
      places: this.area.places.map((p) => ({ n: p.name, lon: p.lon, lat: p.lat })),
      hospitals: this.area.hospitals.map((h) => ({ n: h.name, lon: h.lon, lat: h.lat, inFlood: h.inFlood })),
      incidents: this.incidents.map((i) => ({ id: i.id, title: i.title, lon: i.lon, lat: i.lat, hazard: i.hazard, floodRelated: i.floodRelated, hasImpact: i.hasImpact, distFloodM: i.distFloodM, on: i.incidentOn.slice(0, 10), loss: i.loss })),
    };
  }

  /** Hindcast run: hazard = observed extent (given). Incidents are used only AFTER the model has produced its output. */
  run(params: Partial<CascadeParams> = {}, onEvent?: (e: AgentEvent) => void) {
    const p: CascadeParams = { ...DEFAULT_PARAMS, ...params };
    if (!(p.closeShare > 0 && p.closeShare <= 1) || p.degradeMinutes < 0 || p.degradeRatio < 1) throw new HttpError(400, "Invalid parameters");
    const runId = `HIND-${randomUUID().slice(0, 8)}`;
    const events: AgentEvent[] = [];
    const emit = (agent: AgentEvent["agent"], tool: string, inputs: unknown, summary: string, evidenceIds: string[] = []) => {
      const e: AgentEvent = { id: `${runId}-${events.length + 1}`, ts: new Date().toISOString(), runId, agent, mode: "rule-based", tool, inputs, summary, evidenceIds };
      events.push(e); onEvent?.(e);
    };
    const c = this.prov.counts;
    emit("Coordinator", "assertNetworkPreEvent", { snapshot: this.prov.network.snapshot, eventStart: EVENT_START },
      `Road network snapshot ${this.prov.network.snapshot} is before the event; observed flood extent is used ONLY as the given hazard; incident reports are withheld until scoring.`, ["EV-KTM-OSM", "EV-KTM-UNOSAT"]);
    emit("Hazard Agent", "loadObservedFloodExtent", { source: this.prov.hazardInput.source }, `Hazard GIVEN, not predicted: ${this.prov.hazardInput.source} (${this.prov.hazardInput.observedOn}). Hindcast mode.`, ["EV-KTM-UNOSAT"]);

    const t = Date.now();
    const res = analyzeCascade(this.area, p);
    const k = res.counts;
    emit("Infrastructure Agent", "findExposedAssets", { network: `${k.edges} road segments` },
      `${k.exposedEdges} road segments touch the flood extent; ${k.closedEdges} treated as closed (${k.closedBridges} bridges) under closeShare=${p.closeShare}, bridge-any-contact=${p.bridgeClosesOnAnyContact}. Exposed ≠ closed.`, ["EV-KTM-OSM", "EV-KTM-UNOSAT"]);
    emit("Access Agent", "analyzeCascade", { degradeMinutes: p.degradeMinutes, degradeRatio: p.degradeRatio },
      `${k.direct} places directly flooded; CASCADE: ${k.cascadeIsolated} dry places lose all hospital access, ${k.cascadeDegraded} badly degraded; ${k.strandedEdges} dry roads stranded; ${k.hospitalsFlooded} hospital(s) flooded (computed in ${Date.now() - t} ms).`, ["EV-KTM-OSM"]);

    const score = scoreAgainstIncidents(this.area, res, this.incidents);
    emit("Verification Agent", "scoreAgainstIncidents", { incidents: this.incidents.length, radiusM: score.options.radiusM },
      `Scored AFTER prediction against ${score.evaluated} BIPAD flood/rain incidents with reported impact: ${score.outsideFlood} outside the flood extent, ${score.outsideCovered} within ${score.options.radiusM} m of a predicted cascade item (random-baseline mean ${score.randomBaseline.meanCovered.toFixed(1)}, p=${score.randomBaseline.p.toFixed(3)}; proximity baseline ${score.proximityBaseline.covered}).`, ["EV-KTM-BIPAD"]);

    // Sensitivity of the headline to the (assumed) closure threshold.
    const sens = [0.1, 0.3, 0.5].map((cs) => {
      const r = analyzeCascade(this.area, { ...p, closeShare: cs });
      const s = scoreAgainstIncidents(this.area, r, this.incidents, { ...DEFAULT_SCORE, permutations: 500 });
      return { closeShare: cs, closedEdges: r.counts.closedEdges, cascadeIsolated: r.counts.cascadeIsolated, cascadeDegraded: r.counts.cascadeDegraded, strandedEdges: r.counts.strandedEdges, outsideCovered: s.outsideCovered, outsideFlood: s.outsideFlood, randomMean: s.randomBaseline.meanCovered, p: s.randomBaseline.p, proximity: s.proximityBaseline.covered };
    });
    // EXPLORATORY (added after seeing the primary result): how discriminative is the match radius? Not a primary result.
    const radiusSensitivity = [250, 500, 1000].map((radiusM) => {
      const x = scoreAgainstIncidents(this.area, res, this.incidents, { ...DEFAULT_SCORE, radiusM, permutations: 500 });
      return { radiusM, outsideCovered: x.outsideCovered, outsideFlood: x.outsideFlood, randomMean: x.randomBaseline.meanCovered, p: x.randomBaseline.p, proximity: x.proximityBaseline.covered };
    });
    // Secondary, pre-declared out-of-model check: landslides (model has no landslide physics).
    const slide = scoreAgainstIncidents(this.area, res, this.incidents, { ...DEFAULT_SCORE, primaryHazards: ["Landslide"], permutations: 500 });
    emit("Coordinator", "sensitivityAnalysis", { closeShare: [0.1, 0.3, 0.5] }, `Headline recomputed at three closure thresholds; landslide incidents scored separately as an out-of-model check.`, []);
    return { runId, params: p, result: compact(res), score, sensitivity: sens, radiusSensitivity, landslideCheck: strip(slide), events };
  }
}

const compact = (r: CascadeResult) => ({
  counts: r.counts, closedEdges: r.closedEdges, exposedEdges: r.exposedEdges, strandedEdges: r.strandedEdges,
  placeStatus: r.places.map((p) => p.status), placeT0: r.places.map((p) => p.t0 === null ? null : Math.round(p.t0)), placeT1: r.places.map((p) => p.t1 === null ? null : Math.round(p.t1)),
  hospitals: r.hospitals,
});
const strip = (s: ScoreResult) => ({ evaluated: s.evaluated, inFlood: s.inFlood, outsideFlood: s.outsideFlood, outsideCovered: s.outsideCovered, randomMean: s.randomBaseline.meanCovered, p: s.randomBaseline.p, proximity: s.proximityBaseline.covered });
