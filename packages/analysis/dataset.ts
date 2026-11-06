import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Dataset, Evidence } from "../shared/schemas.ts";
import { z } from "zod";

export const SYNTHETIC_PATH = fileURLToPath(new URL("../../data/synthetic/scenario.json", import.meta.url));
export const POST_EVENT_PATH = fileURLToPath(new URL("../../data/historical/post-event-reference.json", import.meta.url));

/** Schema validation + referential integrity. Throws with every problem listed. */
export function validateDataset(raw: unknown): Dataset {
  const ds = Dataset.parse(raw);
  const problems: string[] = [];
  const nodes = new Set(ds.assets.map((a) => a.id));
  const edges = new Set(ds.roads.map((r) => r.id));
  const ev = new Set(ds.evidence.map((e) => e.id));
  for (const r of ds.roads) for (const n of [r.from, r.to]) if (!nodes.has(n)) problems.push(`road ${r.id}: unknown node ${n}`);
  for (const s of ds.sites) if (!nodes.has(s.nodeId)) problems.push(`site ${s.id}: unknown node ${s.nodeId}`);
  for (const d of ds.demands) if (!nodes.has(d.nodeId)) problems.push(`demand ${d.id}: unknown node ${d.nodeId}`);
  for (const a of ds.assets) {
    if (a.edgeId && !edges.has(a.edgeId)) problems.push(`asset ${a.id}: unknown edge ${a.edgeId}`);
    for (const e of a.evidenceIds) if (!ev.has(e)) problems.push(`asset ${a.id}: unknown evidence ${e}`);
  }
  for (const h of ds.hazards) {
    for (const e of h.closedEdgeIds) if (!edges.has(e)) problems.push(`hazard ${h.id}: closes unknown edge ${e}`);
    for (const s of Object.keys(h.siteEligibility)) if (!ds.sites.some((x) => x.id === s)) problems.push(`hazard ${h.id}: eligibility for unknown site ${s}`);
    for (const e of h.evidenceIds) if (!ev.has(e)) problems.push(`hazard ${h.id}: unknown evidence ${e}`);
  }
  if (problems.length) throw new Error(`Dataset integrity problems:\n- ${problems.join("\n- ")}`);
  return ds;
}

export function loadSyntheticDataset(path = SYNTHETIC_PATH): Dataset {
  return validateDataset(JSON.parse(readFileSync(path, "utf8")));
}

/** Post-event reference items — for the evaluation view only. Never pass these to a planning run. */
export function loadPostEventReference(path = POST_EVENT_PATH) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return z.object({ note: z.string(), evidence: z.array(Evidence) }).parse(raw);
}
