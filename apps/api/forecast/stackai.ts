/**
 * StackAI client. StackAI runs a *deployed flow*, not a bare model, so a call needs three things from the repo-root .env:
 *   STACKAI_API_KEY   the flow's API key (Bearer)
 *   STACKAI_ORG_ID    and STACKAI_FLOW_ID — both are in the flow's Export → API snippet:
 *                     https://api.stackai.com/inference/v0/run/{ORG_ID}/{FLOW_ID}
 * Optional: STACKAI_INPUT (default "in-0") and STACKAI_OUTPUT (default "out-0") if the flow's node ids differ,
 * and STACKAI_BASE_URL to point at a different StackAI host (or a local stub for tests).
 *
 * The flow should be one Input node → one LLM node whose prompt is just {in-0} → one Output node. Every prompt StormAhead
 * sends is self-contained (role, data, format), so the flow needs no prompt of its own.
 *
 * When the flow is not configured, or a call fails, callers get null and fall back to a rule-written summary that the UI
 * labels as such. Nothing pretends an LLM wrote it.
 */
const DEFAULT_BASE = "https://api.stackai.com/inference/v0/run";
const TIMEOUT_MS = 60_000;
const MAX_PARALLEL = 10; // one per agent, so they reason at the same time

export type LlmStatus = { configured: boolean; missing: string[] };

export function llmStatus(env: NodeJS.ProcessEnv = process.env): LlmStatus {
  const missing = ["STACKAI_API_KEY", "STACKAI_ORG_ID", "STACKAI_FLOW_ID"].filter((k) => !env[k]?.trim());
  return { configured: missing.length === 0, missing };
}

// Small semaphore so ten agents finishing together don't hit the flow's rate limit at once.
let active = 0;
const queue: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => queue.push(r));
  active++;
  try { return await fn(); } finally { active--; queue.shift()?.(); }
}

/** Pull the text out of a StackAI response: outputs[out-0], else the first string output. */
function extract(body: unknown, outKey: string): string | null {
  const outputs = (body as { outputs?: Record<string, unknown> } | null)?.outputs;
  if (!outputs) return null;
  const pick = (v: unknown): string | null => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of ["text", "content", "output", "answer"]) if (typeof o[k] === "string") return o[k] as string;
    }
    return null;
  };
  return pick(outputs[outKey]) ?? Object.values(outputs).map(pick).find((s) => !!s) ?? null;
}

export class StackAiError extends Error {}

/** One completion through the configured flow. Returns null when StackAI is not configured. */
export async function complete(prompt: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (!llmStatus(env).configured) return null;
  const inKey = env.STACKAI_INPUT?.trim() || "in-0";
  const outKey = env.STACKAI_OUTPUT?.trim() || "out-0";
  const base = (env.STACKAI_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, "");
  const url = `${base}/${env.STACKAI_ORG_ID!.trim()}/${env.STACKAI_FLOW_ID!.trim()}`;
  return slot(async () => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        method: "POST",
        signal: ctl.signal,
        headers: { Authorization: `Bearer ${env.STACKAI_API_KEY!.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ "user_id": "stormahead-ops", [inKey]: prompt }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new StackAiError(`LLM HTTP ${r.status}${body && (body as any).detail ? `: ${JSON.stringify((body as any).detail).slice(0, 200)}` : ""}`);
      const text = extract(body, outKey);
      if (!text) throw new StackAiError(`LLM returned no text output (looked for "${outKey}")`);
      return text.trim();
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new StackAiError(`LLM timed out after ${TIMEOUT_MS / 1000}s`);
      throw e;
    } finally {
      clearTimeout(t);
    }
  });
}

/** Parse the first JSON object in an LLM reply (models often wrap JSON in prose or code fences). */
export function parseJsonLoose<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("{"), end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(fenced.slice(start, end + 1)) as T; } catch { return null; }
}
