/**
 * Replaceable adapters. The default demo uses only the synthetic implementations.
 * Real integrations (DHM, BIPAD, HDX, Geofabrik, Maxar, NWS, ...) must implement these interfaces and
 * attach provenance + availability times so the temporal guard can reject post-event material.
 */
import type { Dataset, Evidence } from "../shared/schemas.ts";
import { loadSyntheticDataset } from "../analysis/dataset.ts";

export interface DatasetSource {
  readonly label: string;
  readonly kind: "synthetic" | "connected";
  load(): Promise<Dataset>;
}

export const syntheticSource: DatasetSource = {
  label: "Synthetic Nepal-inspired scenario (invented)",
  kind: "synthetic",
  load: async () => loadSyntheticDataset(),
};

/** Provider-neutral LLM interface for the OPTIONAL coordinator mode. Not implemented in this build. */
export interface LlmProvider {
  readonly name: string;
  /** Must call only registered tools; numbers in the final text must equal tool outputs. */
  coordinate(args: { tools: Record<string, { description: string }>; goal: string }): Promise<{ toolCalls: unknown[]; explanation: string }>;
}

/** Placeholder so callers can feature-detect: LLM mode is off unless a provider is registered. */
export const llmProvider: LlmProvider | null = null;

export type EvidenceSource = { label: string; fetch(): Promise<Evidence[]> };
