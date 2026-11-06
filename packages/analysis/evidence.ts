import type { Dataset, Evidence } from "../shared/schemas.ts";

export class TemporalLeakError extends Error {
  constructor(public offending: Evidence[], asOf: string) {
    super(
      `Temporal separation violated: ${offending.map((e) => `${e.id} (${e.phase}, available ${e.availableAt})`).join("; ")} ` +
        `cannot enter a pre-event planning run (cut-off ${asOf}).`,
    );
  }
}

/** Evidence usable by planning: pre-event AND available at or before the cut-off. */
export function isPlanningEligible(e: Evidence, asOf: string): boolean {
  return e.phase === "pre-event" && Date.parse(e.availableAt) <= Date.parse(asOf);
}

/** Throws if ANY evidence supplied to a planning run is post-event or published after the cut-off. */
export function assertPreEvent(evidence: Evidence[], asOf: string): void {
  const bad = evidence.filter((e) => !isPlanningEligible(e, asOf));
  if (bad.length) throw new TemporalLeakError(bad, asOf);
}

/** Every evidence id referenced by dataset objects must exist. Returns the set referenced. */
export function referencedEvidenceIds(ds: Dataset): Set<string> {
  return new Set([...ds.assets.flatMap((a) => a.evidenceIds), ...ds.hazards.flatMap((h) => h.evidenceIds), "EV-SYN-INV"]);
}
