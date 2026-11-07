/** Stream Gemini Live PCM16 LE @ 24 kHz into the browser speakers. */
export function createPcmPlayer(sampleRate = 24_000) {
  let ctx: AudioContext | null = null;
  let next = 0;

  function ensure(): AudioContext {
    if (!ctx) ctx = new AudioContext({ sampleRate });
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }

  function playBase64(b64: string) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const f32 = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) f32[i] = samples[i]! / 32768;
    const ac = ensure();
    const buf = ac.createBuffer(1, f32.length, sampleRate);
    buf.copyToChannel(f32, 0);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    const now = ac.currentTime;
    if (next < now) next = now;
    src.start(next);
    next += buf.duration;
  }

  function reset() {
    next = 0;
  }

  function close() {
    reset();
    void ctx?.close();
    ctx = null;
  }

  return { playBase64, reset, close, unlock: ensure };
}
