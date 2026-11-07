/**
 * Gemini text generation on Vertex AI.
 *
 * AUTH: Application Default Credentials only. The team's Google Cloud organisation disables API keys by policy
 * ("API keys are disallowed. Please use Application Default Credentials (ADC) instead"), so there is no key to
 * configure and none should ever be added here. Each developer runs `gcloud auth application-default login`
 * once; nothing secret enters the repo, the environment, or a config file.
 *
 * COST: calls bill to the project's billing account. Google's free trial credit covers Gemini **through Vertex
 * AI** but explicitly does NOT cover the AI Studio / Generative Language API, which is the other reason this
 * adapter targets Vertex. `maxOutputTokens` is clamped here rather than trusted from the caller, because the
 * realistic failure mode is a loop in a dev server quietly spending a shared budget.
 *
 * DEFAULT OFF: the container wires MockLlmAdapter unless LLM_ADAPTER=vertex, so checking out this repo and
 * running it never touches Google Cloud, never bills anyone, and works with no credentials at all.
 */
import type { LlmPort, LlmRequest, LlmResult, LlmStatus } from "../../ports/index.ts";

export const DEFAULT_MODEL = "gemini-2.5-flash";
export const DEFAULT_LOCATION = "global";
/** Hard ceiling, whatever the caller asks for. */
export const MAX_OUTPUT_TOKENS = 2048;
const DEFAULT_OUTPUT_TOKENS = 512;

const clampTokens = (n: number | undefined) =>
  Math.min(MAX_OUTPUT_TOKENS, Math.max(1, Math.floor(n ?? DEFAULT_OUTPUT_TOKENS)));

/**
 * Deterministic stand-in. No network, no credentials, no cost.
 *
 * It echoes a summary of the request rather than inventing prose, so that output appearing anywhere in the UI
 * is obviously not a real model response. A plausible-looking fake would be worse than an obvious one here:
 * this project's whole discipline is keeping real and simulated clearly separated.
 */
export class MockLlmAdapter implements LlmPort {
  async status(): Promise<LlmStatus> {
    return {
      ready: true, adapter: "mock", model: "mock", project: null, location: null,
      detail: "Mock adapter: returns a canned response, makes no network call and costs nothing. " +
        "Set LLM_ADAPTER=vertex and run `gcloud auth application-default login` to use Gemini on Vertex AI.",
    };
  }
  async generate(req: LlmRequest): Promise<LlmResult> {
    const words = req.prompt.trim().split(/\s+/).length;
    return {
      text: `[MOCK RESPONSE — no model was called]\nPrompt received (${words} word${words === 1 ? "" : "s"})` +
        `${req.system ? `, with a system instruction` : ""}. Set LLM_ADAPTER=vertex for a real answer.`,
      model: "mock", adapter: "mock",
      usage: null, finishReason: "MOCK",
    };
  }
}

type GenAiClient = {
  models: {
    generateContent(args: Record<string, unknown>): Promise<{
      text?: string;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      candidates?: { finishReason?: string }[];
    }>;
  };
};

export class VertexLlmAdapter implements LlmPort {
  private client: GenAiClient | null = null;
  readonly model: string;
  readonly project: string | undefined;
  readonly location: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.model = env.VERTEX_MODEL ?? DEFAULT_MODEL;
    this.project = env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || undefined;
    this.location = env.GOOGLE_CLOUD_LOCATION ?? DEFAULT_LOCATION;
  }

  /** Imported lazily so the dependency is never loaded when the mock adapter is in use. */
  private async getClient(): Promise<GenAiClient> {
    if (this.client) return this.client;
    const { GoogleGenAI } = await import("@google/genai");
    return (this.client = new GoogleGenAI({
      vertexai: true, project: this.project, location: this.location,
    }) as unknown as GenAiClient);
  }

  async status(): Promise<LlmStatus> {
    const base = { adapter: "vertex", model: this.model, project: this.project ?? null, location: this.location };
    if (!this.project) {
      return { ...base, ready: false,
        detail: "GOOGLE_CLOUD_PROJECT is not set. Add it to .env.local, or run " +
          "`gcloud config set project <id>` and export it." };
    }
    try {
      const { GoogleAuth } = await import("google-auth-library");
      const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
      await auth.getClient();
      return { ...base, ready: true, detail: `Application Default Credentials found for project ${this.project}.` };
    } catch (err) {
      return { ...base, ready: false,
        detail: `No usable Application Default Credentials (${(err as Error).message}). Run ` +
          "`gcloud auth application-default login` and " +
          `\`gcloud auth application-default set-quota-project ${this.project}\`.` };
    }
  }

  async generate(req: LlmRequest): Promise<LlmResult> {
    const client = await this.getClient();
    const res = await client.models.generateContent({
      model: this.model,
      contents: req.prompt,
      config: {
        maxOutputTokens: clampTokens(req.maxOutputTokens),
        temperature: req.temperature ?? 0.2,
        ...(req.system ? { systemInstruction: req.system } : {}),
      },
    });
    return {
      text: res.text ?? "",
      model: this.model,
      adapter: "vertex",
      usage: {
        inputTokens: res.usageMetadata?.promptTokenCount ?? null,
        outputTokens: res.usageMetadata?.candidatesTokenCount ?? null,
      },
      finishReason: res.candidates?.[0]?.finishReason ?? null,
    };
  }
}

export { clampTokens as __clampTokens };
