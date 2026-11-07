import { describe, expect, it } from "vitest";
import { buildServer } from "../apps/api/server.ts";
import { buildContainer } from "../apps/api/composition.ts";
import { LlmService } from "../packages/app/index.ts";
import { __clampTokens, MAX_OUTPUT_TOKENS, MockLlmAdapter, VertexLlmAdapter } from "../packages/adapters/vertex/index.ts";
import type { Container } from "../packages/ports/index.ts";

const container = (over: Record<string, string> = {}) => buildContainer({ ...over } as NodeJS.ProcessEnv);

describe("LLM adapter selection", () => {
  it("defaults to the mock adapter, so a fresh clone needs no credentials and bills nobody", async () => {
    const c = container();
    const s = await c.llm.status();
    expect(s.adapter).toBe("mock");
    expect(s.ready).toBe(true);
  });
  // Checked by type rather than by calling status(): a status() call with a project set resolves real ADC,
  // which reaches for the GCE metadata server and makes the suite both slow and noisy.
  it("only uses Vertex when explicitly asked", () => {
    expect(container({ LLM_ADAPTER: "vertex" }).llm).toBeInstanceOf(VertexLlmAdapter);
    expect(container({ LLM_ADAPTER: "VERTEX" }).llm).toBeInstanceOf(VertexLlmAdapter);
    expect(container({ LLM_ADAPTER: "openai" }).llm).toBeInstanceOf(MockLlmAdapter);
    expect(container().llm).toBeInstanceOf(MockLlmAdapter);
  });
  it("exposes no way to pass an API key, because the org disallows them", () => {
    const text = new VertexLlmAdapter({} as NodeJS.ProcessEnv).constructor.toString();
    expect(text).not.toMatch(/apiKey|API_KEY/);
  });
});

describe("mock adapter", () => {
  it("labels its output so a canned response can never be mistaken for a real one", async () => {
    const r = await new MockLlmAdapter().generate({ prompt: "two words" });
    expect(r.text).toContain("MOCK");
    expect(r.adapter).toBe("mock");
    expect(r.finishReason).toBe("MOCK");
  });
  it("makes no network call", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("mock adapter must not reach the network"); }) as typeof fetch;
    try { await expect(new MockLlmAdapter().generate({ prompt: "hi" })).resolves.toBeTruthy(); }
    finally { globalThis.fetch = orig; }
  });
});

describe("Vertex adapter status, without calling a model", () => {
  it("reports what is missing and the command that fixes it, rather than throwing", async () => {
    const s = await new VertexLlmAdapter({} as NodeJS.ProcessEnv).status();
    expect(s.ready).toBe(false);
    expect(s.detail).toMatch(/GOOGLE_CLOUD_PROJECT/);
    expect(s.adapter).toBe("vertex");
  });
  it("reads project, location and model from the environment", async () => {
    const a = new VertexLlmAdapter({ GOOGLE_CLOUD_PROJECT: "proj-1", GOOGLE_CLOUD_LOCATION: "us-central1", VERTEX_MODEL: "gemini-x" } as NodeJS.ProcessEnv);
    expect(a.project).toBe("proj-1");
    expect(a.location).toBe("us-central1");
    expect(a.model).toBe("gemini-x");
  });
});

describe("cost guards", () => {
  it("clamps output tokens however large the request", () => {
    expect(__clampTokens(999999)).toBe(MAX_OUTPUT_TOKENS);
    expect(__clampTokens(undefined)).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
    expect(__clampTokens(0)).toBe(1);
    expect(__clampTokens(-5)).toBe(1);
  });

  const stub = (): Container => ({ ...container(), llm: new MockLlmAdapter() }) as Container;

  it("rate-limits generations, to protect a shared credit balance", async () => {
    const svc = new LlmService(stub(), 3);
    for (let i = 0; i < 3; i++) await svc.generate({ prompt: "x" });
    await expect(svc.generate({ prompt: "x" })).rejects.toThrow(/rate limit/);
  });
  it("rejects an empty or oversized prompt before any call is made", async () => {
    const svc = new LlmService(stub(), 50);
    await expect(svc.generate({ prompt: "   " })).rejects.toThrow(/required/);
    await expect(svc.generate({ prompt: "x".repeat(20001) })).rejects.toThrow(/too long/);
  });
});

describe("API routes", () => {
  it("reports status without needing credentials", async () => {
    const app = await buildServer();
    const r = await app.inject({ method: "GET", url: "/api/llm/status" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ adapter: "mock", ready: true });
    await app.close();
  });
  it("generates through the mock adapter and rejects an empty prompt", async () => {
    const app = await buildServer();
    const ok = await app.inject({ method: "POST", url: "/api/llm/generate", payload: { prompt: "hello" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().text).toContain("MOCK");
    const bad = await app.inject({ method: "POST", url: "/api/llm/generate", payload: { prompt: "" } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});
