import { runOpsTool } from "./opsRunner.ts";
import type { OpsHandle } from "./opsHandle.ts";
import { createPcmPlayer } from "./pcmPlayer.ts";

export type LiveStatus = "idle" | "connecting" | "ready" | "busy" | "error";

export type LiveEvents = {
  onStatus: (s: LiveStatus, detail?: string) => void;
  onCaption: (text: string, role: "assistant" | "user") => void;
  onError: (msg: string) => void;
};

export type LiveConnectOpts = { voice?: string; persona?: string };

function wsUrl(opts?: LiveConnectOpts): string {
  // Dev: hit the API directly — Vite's WS proxy is flaky for Live.
  const base =
    location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "ws://127.0.0.1:3001/api/voice/live"
      : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/voice/live`;
  const q = new URLSearchParams();
  if (opts?.voice) q.set("voice", opts.voice);
  if (opts?.persona) q.set("persona", opts.persona);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

type ToolCall = { id?: string; name?: string; args?: Record<string, unknown>; arguments?: Record<string, unknown> };

function toolCallsFrom(msg: any): ToolCall[] {
  const a = msg.toolCall?.functionCalls ?? msg.tool_call?.function_calls ?? [];
  return Array.isArray(a) ? a : [];
}

function audioB64(part: any): string | null {
  const d = part?.inlineData ?? part?.inline_data;
  if (!d?.data) return null;
  const mime = String(d.mimeType ?? d.mime_type ?? "");
  if (mime && !mime.includes("audio")) return null;
  return String(d.data);
}

/** Text-in Live session: Wispr/typed → client_content; AUDIO out + tools local. */
export function createLiveSession(handle: OpsHandle, events: LiveEvents) {
  let ws: WebSocket | null = null;
  let ready = false;
  let closed = false;
  let activeOpts: LiveConnectOpts = {};
  const player = createPcmPlayer(24_000);

  function setStatus(s: LiveStatus, detail?: string) {
    events.onStatus(s, detail);
  }

  async function handleToolCall(msg: any) {
    const calls = toolCallsFrom(msg);
    if (!calls.length) return;
    setStatus("busy", "Executing…");
    const functionResponses = [];
    for (const call of calls) {
      const name = call.name ?? "";
      const args = (call.args ?? call.arguments ?? {}) as Record<string, unknown>;
      const result = await runOpsTool(handle, name, args);
      functionResponses.push({ id: call.id, name, response: result });
    }
    ws?.send(JSON.stringify({ tool_response: { function_responses: functionResponses } }));
    setStatus("busy", "Speaking…");
  }

  function onMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "proxy.error") {
      events.onError(String(msg.error ?? "Voice proxy error"));
      setStatus("error", msg.error);
      return;
    }
    if (msg.type === "proxy.ready") {
      return;
    }
    if (msg.type === "proxy.close") {
      ready = false;
      const reason = String(msg.reason ?? "");
      if (reason && !closed) {
        events.onError(reason.slice(0, 180) || `Disconnected (${msg.code ?? "?"})`);
        setStatus("error");
      } else if (!closed) setStatus("idle");
      return;
    }
    if (msg.setupComplete || msg.setup_complete) {
      ready = true;
      setStatus("ready");
      return;
    }
    if (msg.toolCall || msg.tool_call) {
      void handleToolCall(msg);
      return;
    }
    const sc = msg.serverContent ?? msg.server_content;
    if (sc?.interrupted) player.reset();
    const outTx = sc?.outputTranscription?.text ?? sc?.output_transcription?.text;
    const inTx = sc?.inputTranscription?.text ?? sc?.input_transcription?.text;
    if (outTx) events.onCaption(String(outTx), "assistant");
    if (inTx) events.onCaption(String(inTx), "user");
    for (const p of sc?.modelTurn?.parts ?? sc?.model_turn?.parts ?? []) {
      if (p.text) events.onCaption(String(p.text), "assistant");
      const b64 = audioB64(p);
      if (b64) {
        try {
          player.playBase64(b64);
        } catch (e) {
          events.onError(`Audio playback failed: ${(e as Error).message}`);
        }
      }
    }
    if (sc?.turnComplete || sc?.turn_complete) setStatus("ready");
  }

  function connect(opts?: LiveConnectOpts) {
    const next = {
      voice: opts?.voice?.trim() || undefined,
      persona: opts?.persona?.trim() || undefined,
    };
    const same =
      ws
      && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
      && (activeOpts.voice ?? "") === (next.voice ?? "")
      && (activeOpts.persona ?? "") === (next.persona ?? "");
    if (same) return;
    // Voice/persona are fixed at Live setup — reconnect to switch agents.
    if (ws) {
      closed = true;
      ws.onclose = null;
      ws.close();
      ws = null;
      ready = false;
    }
    activeOpts = next;
    closed = false;
    player.unlock(); // user gesture unlocks AudioContext
    setStatus("connecting");
    ws = new WebSocket(wsUrl(next));
    ws.onopen = () => setStatus("connecting", "Waiting for Vertex…");
    ws.onmessage = (ev) => onMessage(String(ev.data));
    ws.onerror = () => {
      events.onError("WebSocket error — is the API running with VERTEX_* set?");
      setStatus("error");
    };
    ws.onclose = () => {
      ready = false;
      if (!closed) setStatus("idle");
    };
  }

  function stop() {
    closed = true;
    ready = false;
    activeOpts = {};
    player.reset();
    ws?.close();
    ws = null;
    setStatus("idle");
  }

  function sendText(text: string) {
    const t = text.trim();
    if (!t) return;
    if (!ws || ws.readyState !== WebSocket.OPEN || !ready) {
      events.onError("Connect first, then send (status must be READY).");
      return;
    }
    events.onCaption(t, "user");
    setStatus("busy");
    player.unlock();
    ws.send(
      JSON.stringify({
        client_content: {
          turns: [{ role: "user", parts: [{ text: t }] }],
          turn_complete: true,
        },
      }),
    );
  }

  /** Inject operator context (e.g. focused agent briefing) and let ORACLE acknowledge. */
  function sendContext(text: string) {
    const t = text.trim();
    if (!t) return;
    if (!ws || ws.readyState !== WebSocket.OPEN || !ready) {
      events.onError("Connect Talk first, then select an agent.");
      return;
    }
    setStatus("busy");
    player.unlock();
    ws.send(
      JSON.stringify({
        client_content: {
          turns: [{ role: "user", parts: [{ text: t }] }],
          turn_complete: true,
        },
      }),
    );
  }

  return { connect, stop, sendText, sendContext, getOpts: () => ({ ...activeOpts }) };
}
