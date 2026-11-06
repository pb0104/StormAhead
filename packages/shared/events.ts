/** Agent workflow event (a real tool call + a summary formatted from its output). */
export type AgentName = "Coordinator" | "Hazard Agent" | "Infrastructure Agent" | "Access Agent" | "Verification Agent";
export type AgentEvent = {
  id: string;
  ts: string;
  runId: string;
  agent: AgentName;
  /** "rule-based" = deterministic module; never presented as LLM reasoning. */
  mode: "rule-based" | "llm";
  tool: string;
  inputs: unknown;
  summary: string;
  evidenceIds: string[];
};
