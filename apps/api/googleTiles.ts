/**
 * Google Map Tiles API (2D satellite) for the console's base imagery: native zoom 20 over the Kathmandu valley, against
 * Esri's 18 in this setup. The server keeps GOOGLE_MAPS_API_KEY private, holds one tile session and renews it before it
 * expires, and counts tiles against a daily budget (GOOGLE_TILES_DAILY_BUDGET, default 25,000) so a busy demo can't run up
 * a bill; over budget it answers 429 and the map shows the Esri layer underneath.
 *
 * Google's terms for these tiles: show the Google logo and the copyright for the current view (see /attribution), keep
 * caching to what the tile's own Cache-Control allows (here: a short in-memory cache, never disk), and don't alter the
 * imagery. Needs the "Map Tiles API" enabled on the key's Google Cloud project.
 */
const BASE = "https://tile.googleapis.com";
const TIMEOUT_MS = 10_000;
const MEM_MAX = 1500;                         // tiles kept in memory
const MEM_TTL_MS = 6 * 60 * 60 * 1000;        // well inside the tile's max-age=86400

type Session = { id: string; expiresAt: number };
let session: Session | null = null;
let creating: Promise<Session> | null = null;
let disabledReason: string | null = null;
const mem = new Map<string, { at: number; body: Buffer; type: string }>();
let day = "", used = 0;

const key = () => process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "";
const budget = () => Math.max(0, Number(process.env.GOOGLE_TILES_DAILY_BUDGET ?? 25_000) || 0);

export class TileError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function getSession(force = false): Promise<Session> {
  if (!key()) throw new TileError(404, "GOOGLE_MAPS_API_KEY is not set");
  if (!force && session && session.expiresAt - Date.now() > 60 * 60 * 1000) return session;
  creating ??= (async () => {
    try {
      const r = await fetch(`${BASE}/v1/createSession?key=${encodeURIComponent(key())}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({ mapType: "satellite", language: "en-US", region: "NP" }),
      });
      const body = (await r.json().catch(() => ({}))) as { session?: string; expiry?: string; error?: { message?: string } };
      if (!r.ok || !body.session) {
        // 403 usually means the Map Tiles API isn't enabled for this key: stop asking until restart.
        if (r.status === 403 || r.status === 400) disabledReason = body.error?.message ?? `HTTP ${r.status}`;
        throw new TileError(r.status === 403 ? 403 : 502, `Google tile session failed: ${body.error?.message ?? r.status}`);
      }
      disabledReason = null;
      return (session = { id: body.session, expiresAt: Number(body.expiry) * 1000 || Date.now() + 12 * 60 * 60 * 1000 });
    } finally {
      creating = null;
    }
  })();
  return creating;
}

function spend(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; used = 0; }
  if (used >= budget()) return false;
  used++;
  return true;
}

export function googleStatus() {
  return { available: !!key() && !disabledReason, reason: !key() ? "GOOGLE_MAPS_API_KEY is not set" : disabledReason, maxZoom: 20, usedToday: used, dailyBudget: budget() };
}

export async function googleTile(z: number, x: number, y: number): Promise<{ body: Buffer; type: string; hit: boolean }> {
  if (z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new TileError(400, "Tile out of range");
  if (disabledReason) throw new TileError(403, disabledReason);
  const k = `${z}/${x}/${y}`;
  const hit = mem.get(k);
  if (hit && Date.now() - hit.at < MEM_TTL_MS) { mem.delete(k); mem.set(k, hit); return { body: hit.body, type: hit.type, hit: true }; }
  if (!spend()) throw new TileError(429, `Daily Google tile budget (${budget()}) reached; showing Esri imagery`);
  const fetchTile = async (s: Session) => fetch(`${BASE}/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(s.id)}&key=${encodeURIComponent(key())}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  let r = await fetchTile(await getSession());
  if (r.status === 401 || r.status === 403) r = await fetchTile(await getSession(true)); // session expired early
  if (r.status === 404) throw new TileError(404, "No imagery for this tile");
  if (!r.ok) throw new TileError(502, `Google tile HTTP ${r.status}`);
  const body = Buffer.from(await r.arrayBuffer()), type = r.headers.get("content-type") ?? "image/jpeg";
  mem.set(k, { at: Date.now(), body, type });
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value!);
  return { body, type, hit: false };
}

/** The copyright line Google requires for the current view. */
export async function googleAttribution(zoom: number, n: number, s: number, e: number, w: number): Promise<string> {
  const sess = await getSession();
  const q = new URLSearchParams({ session: sess.id, key: key(), zoom: String(Math.round(zoom)), north: String(n), south: String(s), east: String(e), west: String(w) });
  const r = await fetch(`${BASE}/tile/v1/viewport?${q}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new TileError(502, `Google viewport HTTP ${r.status}`);
  return String(((await r.json()) as { copyright?: string }).copyright ?? "");
}
