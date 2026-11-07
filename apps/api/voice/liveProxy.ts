import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { GoogleAuth } from "google-auth-library";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";
import { DEFAULT_VOICE, OPS_INSTRUCTIONS, OPS_LIVE_TOOLS } from "../../../packages/voice/index.ts";

const execFileAsync = promisify(execFile);

function vertexConfig() {
  const project = process.env.VERTEX_PROJECT_ID?.trim();
  const location = (process.env.VERTEX_LOCATION ?? "us-central1").trim();
  const modelId = (process.env.VERTEX_LIVE_MODEL ?? "gemini-3.8-live").trim();
  if (!project) throw new Error("Set VERTEX_PROJECT_ID in .env");
  return {
    project,
    location,
    model: `projects/${project}/locations/${location}/publishers/google/models/${modelId}`,
    uri: `wss://${location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`,
  };
}

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function accessToken(): Promise<string> {
  try {
    const client = await auth.getClient();
    const t = await client.getAccessToken();
    const token = typeof t === "string" ? t : t?.token;
    if (token) return token;
  } catch { /* fall through to gcloud user login */ }
  try {
    const { stdout } = await execFileAsync("gcloud", ["auth", "print-access-token"], { timeout: 15_000 });
    const token = stdout.trim();
    if (token) return token;
  } catch { /* */ }
  throw new Error("No GCP token. Run: gcloud auth application-default login (or gcloud auth login)");
}

function setupMessage(model: string, opts: { voice?: string; persona?: string } = {}) {
  // Snake_case matches verified Vertex Live smoke on this project.
  const voice = (opts.voice || process.env.VERTEX_LIVE_VOICE || DEFAULT_VOICE).trim();
  const persona = opts.persona?.trim();
  const instruction = persona
    ? `${OPS_INSTRUCTIONS}\n\nACTIVE CHANNEL: You are speaking as "${persona}" (not ORACLE). Introduce yourself as ${persona}. Answer from your briefing only. If the operator addresses a different agent (e.g. "hey rivers", "talk to power"), call focus_forecast_agent to hand off — do not answer for them.`
    : OPS_INSTRUCTIONS;
  return {
    setup: {
      model,
      generation_config: {
        response_modalities: ["AUDIO"],
        speech_config: {
          voice_config: {
            prebuilt_voice_config: { voice_name: voice },
          },
        },
      },
      system_instruction: { parts: [{ text: instruction }] },
      tools: [
        {
          function_declarations: OPS_LIVE_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ],
      output_audio_transcription: {},
    },
  };
}

/** Browser ↔ Vertex Live JSON proxy. Tools run in the browser; this only shuttles frames + injects setup. */
export async function registerLiveVoice(app: FastifyInstance) {
  await app.register(websocket);

  app.get("/api/voice/live", { websocket: true }, async (socket, req) => {
    let upstream: WebSocket | null = null;
    const sendClient = (obj: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(obj));
    };
    const q = (req.query ?? {}) as { voice?: string; persona?: string };
    const voice = typeof q.voice === "string" ? q.voice : undefined;
    const persona = typeof q.persona === "string" ? q.persona : undefined;

    try {
      const cfg = vertexConfig();
      const token = await accessToken();
      upstream = new WebSocket(cfg.uri, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-goog-user-project": cfg.project,
        },
      });

      upstream.on("open", () => {
        upstream!.send(JSON.stringify(setupMessage(cfg.model, { voice, persona })));
        sendClient({ type: "proxy.ready", model: cfg.model, voice: voice || DEFAULT_VOICE, persona: persona || null });
      });

      upstream.on("message", (data) => {
        const text = typeof data === "string" ? data : data.toString();
        if (socket.readyState === socket.OPEN) socket.send(text);
      });

      upstream.on("error", (err) => {
        sendClient({ type: "proxy.error", error: err.message || String(err) });
      });

      upstream.on("close", (code, reason) => {
        sendClient({ type: "proxy.close", code, reason: reason.toString() });
        if (socket.readyState === socket.OPEN) socket.close();
      });

      socket.on("message", (raw) => {
        if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
        const text = typeof raw === "string" ? raw : raw.toString();
        try {
          const msg = JSON.parse(text) as { type?: string };
          if (msg?.type?.startsWith("proxy.")) return;
        } catch { /* forward */ }
        upstream.send(text);
      });

      socket.on("close", () => {
        upstream?.close();
      });
    } catch (e) {
      sendClient({ type: "proxy.error", error: (e as Error).message || String(e) });
      socket.close();
    }
  });

  app.get("/api/voice/status", async () => {
    try {
      const cfg = vertexConfig();
      return { ok: true, project: cfg.project, location: cfg.location, model: cfg.model };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
}
