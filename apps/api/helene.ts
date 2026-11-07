import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Closure } from "../../packages/analysis/replay.ts";
import { HttpError } from "./common.ts";
import { EVENT_START } from "./hindcast.ts";

export const HELENE_DIR = fileURLToPath(new URL("../../data/real/helene/", import.meta.url));
const FILES = ["provenance.json", "network.json", "tims.json", "tims_match.json"];
type Match = { edge: number | null; distM: number | null; how: "ref" | "nearest" | "unmatched"; nearestAlso: number[] };
const HELENE_EVENT_START = "2024-09-25T00:00:00Z";

/** The road snapshot must predate the storm, else the replay's "pre-storm network" claim is false. */
export function assertHeleneNetworkPreStorm(p: { network: { snapshot: string; phase: string } }) {
  if (Date.parse(p.network.snapshot) >= Date.parse(HELENE_EVENT_START) || p.network.phase !== "pre-event")
    throw new HttpError(422, `Temporal separation violated: network snapshot ${p.network.snapshot} (${p.network.phase}) is not before Helene (${HELENE_EVENT_START}).`);
}

export class HeleneService {
  prov: any; network: any; closures: (Closure & { edge: number | null; match: Match["how"]; snapDistM: number | null })[]; tims: any;

  constructor(dir = HELENE_DIR) {
    this.prov = JSON.parse(readFileSync(dir + "provenance.json", "utf8"));
    assertHeleneNetworkPreStorm(this.prov);
    this.network = JSON.parse(readFileSync(dir + "network.json", "utf8"));
    this.tims = JSON.parse(readFileSync(dir + "tims.json", "utf8"));
    const match: Record<string, Match> = JSON.parse(readFileSync(dir + "tims_match.json", "utf8"));
    const [w, e] = this.prov.bbox.length === 4 ? [this.prov.bbox.slice(0, 2), this.prov.bbox.slice(2)] : [[0, 0], [0, 0]];
    this.closures = (this.tims.records as Closure[])
      .filter((r) => r.lon >= w[0] && r.lon <= e[0] && r.lat >= w[1] && r.lat <= e[1])
      .map((r) => { const m = match[String(r.id)]; return { ...r, edge: m?.edge ?? null, match: m?.how ?? "unmatched", snapDistM: m?.distM ?? null }; });
  }

  static available(dir = HELENE_DIR) { return FILES.every((f) => existsSync(dir + f)); }

  meta() {
    const counties = [...new Set(this.closures.map((c) => c.county))].sort();
    const by = (f: (c: any) => string) => this.closures.reduce<Record<string, number>>((m, c) => ((m[f(c)] = (m[f(c)] ?? 0) + 1), m), {});
    return {
      available: true, provenance: this.prov, counties, records: this.closures.length, byMatch: by((c) => c.match), byCondition: by((c) => c.condition),
      replayRange: [this.tims.window[0], this.tims.window[1]],
      caveats: [
        "NCDOT entered these records after the event (all ≥ 13 days after their start), so the timeline is a RECONSTRUCTION, not an archive of what DriveNC showed live.",
        "Points, not lines; state-maintained roads only; completeness unknown; NCDOT disclaims liability for errors.",
        "Closure ↔ road matching is approximate (road number first, else nearest road within 250 m).",
        "No prediction is made yet: this view shows reported restrictions.",
      ],
    };
  }
  /** Compact network for the map (client builds geometry from nodes + edges). */
  roads() { return { nodes: this.network.nodes, edges: this.network.edges }; }
  closuresList() { return this.closures; }
}
export { EVENT_START };
