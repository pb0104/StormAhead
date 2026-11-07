/**
 * Ward-level evaluation and the per-agent scorecard.
 *
 * The earlier scoring asked "is an incident report within 1 km of something we flagged?". In a valley this dense
 * that question is almost free to answer yes to, which is why every baseline tied the model. This module asks a
 * harder and more useful question: **for each ward, did we flag it, and did it actually report damage?**
 *
 * That buys three things the radius test could not give:
 *   1. False alarms are countable. Flagging a ward that reported nothing is now a visible cost, so an agent
 *      cannot score well by flagging everything.
 *   2. The unit matches the ground truth. BIPAD records are ward-level reports, so a ward is the resolution the
 *      truth actually exists at; a 1 km circle around a ward-level point was false precision.
 *   3. Each agent is scored separately, so "which agent's concerns were worth raising" has an answer.
 *
 * Honest limits, unchanged by any of this: the ground truth is a small number of REPORTED incidents, a ward with
 * no report is not necessarily undamaged, and with so few reports the confidence intervals are wide. Ward
 * polygons are evaluation geometry only and never enter the model.
 */
import type { CascadeResult, Incident, RealArea } from "./cascade.ts";

export type WardRing = [number, number][];
export type Ward = { id: number; name: string; ward: string | null; municipality: string | null; areaM2: number; at: [number, number]; rings: WardRing[] };

const KX = 98600, KY = 110600;
const dm = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);

function inRing(lon: number, lat: number, ring: WardRing): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

type Boxed = { w: Ward; bb: [number, number, number, number] };
/** Ward lookup with a bounding-box prefilter: the ring test only runs for wards whose box contains the point. */
export function wardIndex(wards: Ward[]) {
  const boxed: Boxed[] = wards.map((w) => {
    const pts = w.rings.flat();
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { w, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  const byId = new Map(wards.map((w, i) => [w.id, i]));
  return (lon: number, lat: number): number => {
    for (const { w, bb } of boxed) {
      if (lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) continue;
      if (w.rings.some((r) => inRing(lon, lat, r))) return byId.get(w.id)!;
    }
    return -1;
  };
}

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export type Confusion = { tp: number; fp: number; fn: number; tn: number; precision: number | null; recall: number | null; f1: number | null; iou: number | null };
/** Confusion matrix of flagged wards against wards that reported damage. */
export function confusion(flagged: Set<number>, truth: Set<number>, total: number): Confusion {
  let tp = 0, fp = 0;
  for (const i of flagged) (truth.has(i) ? tp++ : fp++);
  const fn = truth.size - tp, tn = total - tp - fp - fn;
  const precision = flagged.size ? tp / flagged.size : null;
  const recall = truth.size ? tp / truth.size : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  const union = flagged.size + truth.size - tp;
  return { tp, fp, fn, tn, precision, recall, f1, iou: union ? tp / union : null };
}

export type AgentScore = {
  agent: string; what: string;
  flaggedWards: number;
  confusion: Confusion;
  /** Same number of wards drawn at random from the candidate pool. */
  randomBaseline: { meanTp: number; meanF1: number; p: number };
  /** Same number of wards, chosen as those nearest the flood — no network reasoning at all. */
  proximityBaseline: { tp: number; f1: number | null };
};

/**
 * What happened in one ward, for drawing the verification map.
 *  hit            - we flagged it and it reported damage
 *  false-alarm    - we flagged it and nothing was reported
 *  miss           - it reported damage and we said nothing
 *  correct-reject - we said nothing and nothing was reported
 */
export type WardOutcome = "hit" | "false-alarm" | "miss" | "correct-reject";
export type WardDetail = {
  id: number; name: string; at: [number, number];
  outcome: WardOutcome; reported: boolean; incidents: number;
  /** Which agents flagged this ward (the given-hazard row is excluded: it is an input, not a prediction). */
  flaggedBy: string[];
};

export type WardScorecard = {
  wards: number; evaluatedIncidents: number; truthWards: number;
  permutations: number;
  agents: AgentScore[];
  /** Per-ward result, so the table can be drawn as a map. */
  detail: WardDetail[];
  note: string;
};

export type WardScoreOptions = { permutations: number; seed: number; primaryHazards: string[] };
export const DEFAULT_WARD_SCORE: WardScoreOptions = { permutations: 2000, seed: 20240927, primaryHazards: ["Flood", "Inundation", "Heavy Rainfall"] };

/**
 * Score each agent's concerns against the wards that reported damage.
 *
 * Every agent is compared with two baselines drawn the SAME size as its own flagged set, so an agent that flags
 * more wards is not rewarded for breadth: the baselines grow with it.
 */
export function scoreByWard(
  area: RealArea, res: CascadeResult, incidents: Incident[], wards: Ward[], opt: WardScoreOptions = DEFAULT_WARD_SCORE,
): WardScorecard {
  const find = wardIndex(wards);
  const N = wards.length;

  // --- ground truth: wards with at least one verified, impactful, flood-related report ---
  const scored = incidents.filter((i) => i.floodRelated && i.hasImpact && opt.primaryHazards.includes(i.hazard));
  const truth = new Set<number>();
  for (const i of scored) { const w = find(i.lon, i.lat); if (w >= 0) truth.add(w); }

  // --- ward distance to the flood, for the proximity baseline (uses exposed edges, already in the model input) ---
  const exposed = res.exposedEdges.map((i) => area.edges[i]!.mid);
  const wardDist = wards.map((w) => (exposed.length ? Math.min(...exposed.map((m) => dm(w.at, m))) : Infinity));
  const byFlood = wards.map((_, i) => i).sort((a, b) => wardDist[a]! - wardDist[b]!);

  const rnd = mulberry32(opt.seed);
  const pool = wards.map((_, i) => i);
  const score = (agent: string, what: string, flagged: Set<number>): AgentScore => {
    const c = confusion(flagged, truth, N);
    const k = flagged.size;
    let sumTp = 0, sumF1 = 0, ge = 0;
    for (let t = 0; t < opt.permutations; t++) {
      const a = pool.slice();
      for (let i = 0; i < Math.min(k, a.length); i++) { const j = i + Math.floor(rnd() * (a.length - i)); [a[i], a[j]] = [a[j]!, a[i]!]; }
      const s = confusion(new Set(a.slice(0, k)), truth, N);
      sumTp += s.tp; sumF1 += s.f1 ?? 0;
      if ((s.f1 ?? 0) >= (c.f1 ?? 0)) ge++;
    }
    const prox = confusion(new Set(byFlood.slice(0, k)), truth, N);
    return {
      agent, what, flaggedWards: k, confusion: c,
      randomBaseline: { meanTp: sumTp / opt.permutations, meanF1: sumF1 / opt.permutations, p: (ge + 1) / (opt.permutations + 1) },
      proximityBaseline: { tp: prox.tp, f1: prox.f1 },
    };
  };

  const wardsOf = (pts: [number, number][]) => { const s = new Set<number>(); for (const p of pts) { const w = find(p[0], p[1]); if (w >= 0) s.add(w); } return s; };

  // --- what each agent actually claimed ---
  const closedW = wardsOf(res.closedEdges.map((i) => area.edges[i]!.mid));
  const accessPts: [number, number][] = [
    ...res.places.filter((p) => p.status === "cascade-isolated" || p.status === "cascade-degraded").map((p) => [area.places[p.index]!.lon, area.places[p.index]!.lat] as [number, number]),
    ...res.strandedEdges.map((i) => area.edges[i]!.mid),
  ];
  const accessW = wardsOf(accessPts);
  const shelterW = wardsOf(res.buildings
    .filter((b) => b.role !== "none" && b.role !== "unknown-height")
    .map((b) => [area.buildings![b.index]!.lon, area.buildings![b.index]!.lat] as [number, number]));
  const exposedW = wardsOf(exposed);
  const allW = new Set<number>([...closedW, ...accessW, ...shelterW]);

  const agents: AgentScore[] = [
    // The hazard is a GIVEN input, so this is not a prediction. It is the bar every agent below must clear:
    // if knowing which wards the flood touches already identifies the damaged wards, the cascade adds nothing.
    score("Hazard (GIVEN, not a prediction)", "wards the observed flood extent touches", exposedW),
    score("Infrastructure Agent", "wards containing a road it closed", closedW),
    score("Access Agent", "wards containing a place that lost hospital access, or a stranded road", accessW),
    ...(area.buildings?.length ? [score("Shelter Agent", "wards containing a building it flagged to evacuate, shelter or use as refuge", shelterW)] : []),
    score("All agents combined", "wards flagged by any agent", allW),
  ];

  // Per-ward outcome. The hazard row is deliberately left out of `flaggedBy`: it is the model's input, so
  // counting it as a prediction would make the map look better than the model is.
  const predictors: [string, Set<number>][] = [
    ["Infrastructure", closedW], ["Access", accessW],
    ...(area.buildings?.length ? [["Shelter", shelterW] as [string, Set<number>]] : []),
  ];
  const incidentCount = new Map<number, number>();
  for (const i of scored) { const w = find(i.lon, i.lat); if (w >= 0) incidentCount.set(w, (incidentCount.get(w) ?? 0) + 1); }
  const detail: WardDetail[] = wards.map((w, i) => {
    const flaggedBy = predictors.filter(([, set]) => set.has(i)).map(([n]) => n);
    const reported = truth.has(i);
    const outcome: WardOutcome = flaggedBy.length
      ? (reported ? "hit" : "false-alarm")
      : (reported ? "miss" : "correct-reject");
    return { id: w.id, name: w.name, at: w.at, outcome, reported, incidents: incidentCount.get(i) ?? 0, flaggedBy };
  });

  return {
    wards: N, evaluatedIncidents: scored.length, truthWards: truth.size, permutations: opt.permutations, agents, detail,
    note: "Ground truth is REPORTED damage: a ward with no report is not proven undamaged, so recall is a lower bound and " +
      "false alarms may include real damage that went unreported. The hazard row is the observed flood extent, which is a " +
      "model INPUT, not a prediction — it is the bar the agents must beat to have added anything.",
  };
}
