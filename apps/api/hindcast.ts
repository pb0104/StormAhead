import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { analyzeCascade, DEFAULT_PARAMS, DEFAULT_SCORE, scoreAgainstIncidents, SHELTER, type CascadeParams, type CascadeResult, type Incident, type RealArea, type RealBuilding, type ScoreResult } from "../../packages/analysis/cascade.ts";
import { DEFAULT_WARD_SCORE, scoreByWard, type Ward, type WardScorecard } from "../../packages/analysis/wards.ts";
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

/** Buildings are a model input too, so they must predate the event just like the road network. */
export function assertBuildingsPreEvent(b: { snapshot: string; phase: string }) {
  if (Date.parse(b.snapshot) >= Date.parse(EVENT_START) || b.phase !== "pre-event")
    throw new HttpError(422, `Temporal separation violated: building snapshot ${b.snapshot} (${b.phase}) is not before the event (${EVENT_START}).`);
}

export class HindcastService {
  area: RealArea; floodGeo: unknown; incidents: Incident[]; prov: Provenance; incidentsMeta: Record<string, unknown>;
  buildingsMeta: Record<string, unknown> | null = null;
  /** Footprint rings, parallel to area.buildings. Kept out of RealBuilding: the engine reasons about centroids. */
  private buildingRings: [number, number][][] | null = null;
  private buildingsGeoCache: unknown = null;
  private scorecardCache: unknown = null;
  private verifyGeoCache: unknown = null;
  /** Ward polygons: EVALUATION geometry only, never a model input. */
  wards: Ward[] = [];
  wardsMeta: Record<string, unknown> | null = null;
  private roadsGeo: unknown = null;

  constructor(dir = KTM_DIR) {
    this.prov = JSON.parse(readFileSync(dir + "provenance.json", "utf8"));
    assertNetworkPreEvent(this.prov);
    const net = JSON.parse(readFileSync(dir + "network.json", "utf8"));
    const pl = JSON.parse(readFileSync(dir + "places.json", "utf8"));
    // Buildings are optional: the engine and its existing results work without the file.
    let buildings: RealBuilding[] | undefined;
    if (existsSync(dir + "buildings.json")) {
      const bf = JSON.parse(readFileSync(dir + "buildings.json", "utf8"));
      assertBuildingsPreEvent(bf);
      this.buildingsMeta = { source: bf.source, snapshot: bf.snapshot, licence: bf.licence, note: bf.note, counts: bf.counts };
      this.buildingRings = bf.buildings.map((b: any) => b.ring);
      buildings = bf.buildings.map((b: any) => ({
        id: b.id, name: b.name ?? `${b.type} (unnamed)`, type: b.type, lon: b.lon, lat: b.lat,
        node: b.node, inFlood: b.inFlood, distFloodM: b.distFloodM, floors: b.floors, areaM2: b.areaM2,
      }));
    }
    this.area = {
      nodes: net.nodes,
      edges: net.edges.map((e: any[]) => ({ u: e[0], v: e[1], minutes: e[2], lengthM: e[3], cls: e[4], bridge: !!e[5], floodedShare: e[6], name: e[7], osmWayId: e[8], mid: e[9], distFloodM: e[10], via: e[11] })),
      places: pl.places, hospitals: pl.hospitals, buildings,
    };
    if (existsSync(dir + "wards.json")) {
      const wf = JSON.parse(readFileSync(dir + "wards.json", "utf8"));
      this.wards = wf.wards;
      this.wardsMeta = { source: wf.source, snapshot: wf.snapshot, licence: wf.licence, role: wf.role, counts: wf.counts };
    }
    this.floodGeo = JSON.parse(readFileSync(dir + "flood_extent.geojson", "utf8"));
    const inc = JSON.parse(readFileSync(dir + "incidents.json", "utf8"));
    this.incidents = inc.incidents; this.incidentsMeta = { source: inc.source, window: inc.window, retrievedAt: inc.retrievedAt, note: inc.note, nationalIncidentsInWindow: inc.nationalIncidentsInWindow };
  }

  static available(dir = KTM_DIR) { return ["provenance", "network", "places", "flood_extent", "incidents"].every((f) => existsSync(dir + f + (f === "flood_extent" ? ".geojson" : ".json"))); }

  meta() {
    return { available: true, provenance: this.prov, incidents: this.incidentsMeta, buildings: this.buildingsMeta, wards: this.wardsMeta, shelterAssumptions: SHELTER, evaluationIncidents: this.incidents.length, defaults: { params: DEFAULT_PARAMS, score: DEFAULT_SCORE } };
  }

  /**
   * Building footprints for the console, as GeoJSON. Cached, and trimmed to what the map needs: the console
   * derives its own shelter reading from its depth model, so no engine verdict is sent with them.
   */
  buildingsGeo() {
    if (!this.area.buildings?.length) return null;
    this.buildingsGeoCache ??= {
      type: "FeatureCollection",
      meta: this.buildingsMeta,
      features: this.area.buildings.map((b, i) => ({
        type: "Feature",
        properties: { i, id: b.id, name: b.name, t: b.type, f: b.floors, a: b.areaM2, inFlood: b.inFlood ? 1 : 0 },
        geometry: { type: "Polygon", coordinates: [this.buildingRings![i]] },
      })),
    };
    return this.buildingsGeoCache;
  }

  /**
   * Per-agent ward scorecard on its own, without the sensitivity sweeps that make a full run slow.
   * This evaluates the REAL hindcast engine against withheld incident reports — it says nothing about the
   * demo console's mock closures, and the UI that shows it must say so.
   */
  scorecard() {
    if (!this.wards.length) return null;
    this.scorecardCache ??= {
      wardScore: scoreByWard(this.area, analyzeCascade(this.area, DEFAULT_PARAMS), this.incidents, this.wards, DEFAULT_WARD_SCORE),
      network: { source: this.prov.network.source, snapshot: this.prov.network.snapshot },
      wards: this.wardsMeta,
      incidents: { source: this.incidentsMeta.source, window: this.incidentsMeta.window },
    };
    return this.scorecardCache;
  }

  /**
   * The verification map: ward polygons carrying their outcome (hit / false alarm / miss), plus the incident
   * points that form the ground truth. This is the scorecard drawn as geography.
   */
  verificationGeo() {
    const sc = this.scorecard() as { wardScore: WardScorecard } | null;
    if (!sc) return null;
    this.verifyGeoCache ??= (() => {
      const byId = new Map(this.wards.map((w) => [w.id, w]));
      const scored = this.incidents.filter((i) => i.floodRelated && i.hasImpact && DEFAULT_WARD_SCORE.primaryHazards.includes(i.hazard));
      return {
        wards: {
          type: "FeatureCollection",
          features: sc.wardScore.detail.flatMap((d) => {
            const w = byId.get(d.id);
            if (!w) return [];
            return [{
              type: "Feature",
              properties: { id: d.id, name: d.name, outcome: d.outcome, reported: d.reported ? 1 : 0, incidents: d.incidents, flaggedBy: d.flaggedBy.join(", ") },
              geometry: { type: "Polygon", coordinates: w.rings },
            }];
          }),
        },
        incidents: {
          type: "FeatureCollection",
          features: scored.map((i) => ({
            type: "Feature",
            properties: { id: i.id, title: i.title, hazard: i.hazard, on: i.incidentOn.slice(0, 10) },
            geometry: { type: "Point", coordinates: [i.lon, i.lat] },
          })),
        },
        summary: { wards: sc.wardScore.wards, truthWards: sc.wardScore.truthWards, evaluatedIncidents: sc.wardScore.evaluatedIncidents },
        note: "Scores the REAL hindcast engine against withheld BIPAD reports. The closures drawn on the console map are demo data and are NOT what is scored here.",
      };
    })();
    return this.verifyGeoCache;
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

    if (this.area.buildings?.length) {
      emit("Shelter Agent", "assessBuildings", { buildings: k.buildings, m2PerPerson: SHELTER.m2PerPerson, usableFraction: SHELTER.usableFraction },
        `${k.buildings} shelter-relevant buildings (pre-event OSM footprints): ${k.buildingsFlooded} stand in the flood extent, ` +
        `${k.buildingsIsolated} dry ones lose all hospital access, ${k.buildingsDegraded} badly degraded. ` +
        `Shelter reading: ${k.shelterVertical} flooded with floors above the water, ${k.shelterEvacuate} flooded with none (evacuate), ` +
        `${k.shelterRefuge} dry upper-floor refuges inside cut-off areas (about ${(k.refugeCapacity ?? 0).toLocaleString("en-US")} places at ${SHELTER.m2PerPerson} m²/person). ` +
        `${k.buildingsUnknownHeight} have no usable building:levels and get NO judgement.`, ["EV-KTM-OSM-BUILDINGS"]);
    }

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
    // Buildings as cascade targets. Reported ALONGSIDE the primary headline, never replacing it: the target set
    // was chosen after the first null result, so these are exploratory, not a pre-registered test.
    const buildingTargets = this.area.buildings?.length ? {
      withBuildings: strip(scoreAgainstIncidents(this.area, res, this.incidents, { ...DEFAULT_SCORE, includeBuildings: true })),
      buildingsOnly: strip(scoreAgainstIncidents(this.area, res, this.incidents, { ...DEFAULT_SCORE, buildingsOnly: true })),
      note: "EXPLORATORY: target set chosen after seeing the primary null result. Baselines draw the same number of items per class from the same dry pools, so a larger target set cannot flatter the model.",
    } : null;
    // Ward-level scorecard: each agent's concerns against the wards that actually reported damage.
    let wardScore: WardScorecard | null = null;
    if (this.wards.length) {
      wardScore = scoreByWard(this.area, res, this.incidents, this.wards, DEFAULT_WARD_SCORE);
      const line = wardScore.agents.map((a) => {
        const c = a.confusion;
        return `${a.agent}: flagged ${a.flaggedWards}, hit ${c.tp}/${wardScore!.truthWards} (random ${a.randomBaseline.meanTp.toFixed(1)}, p=${a.randomBaseline.p.toFixed(3)}), ${c.fp} false alarms`;
      }).join(" | ");
      emit("Verification Agent", "scoreByWard", { wards: wardScore.wards, truthWards: wardScore.truthWards },
        `Ward-level scorecard over ${wardScore.wards} wards; ${wardScore.truthWards} reported damage. ${line}`, ["EV-KTM-BIPAD", "EV-KTM-WARDS"]);
    }
    emit("Coordinator", "sensitivityAnalysis", { closeShare: [0.1, 0.3, 0.5] }, `Headline recomputed at three closure thresholds; landslide incidents scored separately as an out-of-model check.`, []);
    return { runId, params: p, result: compact(res), score, sensitivity: sens, radiusSensitivity, landslideCheck: strip(slide), buildingTargets, wardScore, events };
  }
}

const compact = (r: CascadeResult) => ({
  counts: r.counts, closedEdges: r.closedEdges, exposedEdges: r.exposedEdges, strandedEdges: r.strandedEdges,
  placeStatus: r.places.map((p) => p.status), placeT0: r.places.map((p) => p.t0 === null ? null : Math.round(p.t0)), placeT1: r.places.map((p) => p.t1 === null ? null : Math.round(p.t1)),
  hospitals: r.hospitals,
  buildings: r.buildings.map((b) => ({ i: b.index, s: b.status, role: b.role, f: b.usableFloors, cap: b.capacity })),
});
const strip = (s: ScoreResult) => ({ evaluated: s.evaluated, inFlood: s.inFlood, outsideFlood: s.outsideFlood, outsideCovered: s.outsideCovered, randomMean: s.randomBaseline.meanCovered, p: s.randomBaseline.p, proximity: s.proximityBaseline.covered, flagged: s.flagged });
