/** Forecast console client: factor list, intent parsing and the streamed agent run (server-sent events over POST). */
export type Severity = "severe" | "high" | "moderate" | "info";
export type Risk = "low" | "moderate" | "high" | "severe";
export type AgentMeta = { id: string; name: string; factor: string; blurb: string; sources: string };
export type LlmStatus = { configured: boolean; missing: string[] };
export type Factors = { now: string; nowLabel: string; llm: LlmStatus; agents: AgentMeta[] };
export type Window = { startIdx: number; start: string; end: string; startLabel: string; endLabel: string; hours: number; label: string; replayNote: string };
export type Intent = { hours: number; suggested: string[]; window: Window; clamped: boolean };
export type MapAlert = { id: string; agent: string; lon: number; lat: number; severity: Severity; title: string; detail: string; at: number | null; when: string | null };
export type AgentResult = {
  headline: string; risk: Risk; facts: Record<string, string | number>; alerts: MapAlert[]; caveats: string[]; map?: Record<string, unknown>;
  thinking: string[]; watch: string; by: "stackai" | "rules"; llmError?: string;
  /** Headline numbers to show as-is (e.g. the resource agent's budget). */
  figures?: { label: string; value: string; note?: string }[];
};
export type Combined = { coverage?: import("./actionsApi.ts").Coverage; id: string; priority: "P1" | "P2"; lon: number; lat: number; place: string; agents: string[]; title: string; why: string[]; at: number | null; when: string | null; severity: Severity };
export type ForecastEvent =
  | { type: "run"; runId: string; question: string; window: Window; agents: string[]; llm: LlmStatus }
  | { type: "agent"; id: string; status: "running" }
  | { type: "step"; id: string; kind: string; text: string; t: number }
  | { type: "agent_done"; id: string; ms: number; result: AgentResult }
  | { type: "fusion_step"; text: string }
  | { type: "fusion"; findings: Combined[] }
  | { type: "report_start" }
  | { type: "report"; markdown: string; by: "stackai" | "rules"; error?: string }
  | { type: "done"; ms: number }
  | { type: "error"; message: string };

export const getFactors = async (): Promise<Factors> => {
  const r = await fetch("/api/forecast/factors");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
export const getIntent = async (question: string): Promise<Intent> => {
  const r = await fetch("/api/forecast/intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

/** Run the agents. Calls onEvent for each server event until the stream ends or the signal aborts. */
export async function streamForecast(body: { question: string; hours: number; factors: string[] }, onEvent: (e: ForecastEvent) => void, signal: AbortSignal) {
  const r = await fetch("/api/forecast/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) throw new Error(`Forecast run failed: HTTP ${r.status}`);
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) { try { onEvent(JSON.parse(line.slice(6)) as ForecastEvent); } catch { /* skip malformed */ } }
    }
  }
}
