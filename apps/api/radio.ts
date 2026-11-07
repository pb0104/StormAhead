/**
 * Live broadcast radio for the console, from the Radio Browser directory (radio-browser.info, public-domain directory data,
 * PDDL 1.0). Same approach as gods-eye-view: the server only fetches and caches the station LIST; pressing play connects the
 * operator's browser straight to the broadcaster's own stream. StormAhead never proxies, records, stores or transcribes audio,
 * and broadcast audio is never fed to the agents. Each broadcaster's stream terms apply.
 *
 * This is live radio as of today. It is NOT part of the Sep 2024 replay, and it is broadcast radio (news / FM), not
 * emergency-services traffic: scanner feeds such as Broadcastify forbid automated access and AI use (see CLAUDE.md).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MIRRORS = ["https://de1.api.radio-browser.info", "https://de2.api.radio-browser.info", "https://nl1.api.radio-browser.info"];
const UA = "StormAhead/0.1 (Radio Browser directory client)";
const FRESH_MS = 45 * 60 * 1000;            // refetch the directory at most every 45 min
const STALE_MS = 7 * 24 * 60 * 60 * 1000;   // serve the last good list for up to a week if the directory is down
const FAIL_BACKOFF_MS = 60 * 1000;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 4 * 1024 * 1024;
const CACHE_FILE = fileURLToPath(new URL("../../data/cache/radio/np.json", import.meta.url));
const COUNTRY = "NP";
/** Valley centre, for distance and the "in the valley" flag. */
const VALLEY_C: [number, number] = [85.385, 27.69];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Station = {
  id: string; name: string; url: string; homepage: string | null; codec: string; bitrate: number;
  tags: string[]; language: string; state: string; lat: number | null; lon: number | null;
  distKm: number | null; inValley: boolean; news: boolean; local: boolean; clicks: number; votes: number;
};
export type RadioDirectory = { source: string; licence: string; note: string; retrievedAt: string; stale: boolean; stations: Station[] };

type Raw = {
  stationuuid: string; name: string; url_resolved: string; homepage: string; codec: string; bitrate: number; hls: number;
  tags: string; language: string; state: string; geo_lat: number | null; geo_long: number | null; clickcount: number; votes: number; lastcheckok: number;
};

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, redirect: "error", headers: { "User-Agent": UA, Accept: "application/json", ...(init?.headers ?? {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new Error("directory response too large");
    return JSON.parse(new TextDecoder().decode(buf)) as T;
  } finally {
    clearTimeout(t);
  }
}

/** Try each mirror in turn; the directory asks clients to spread load and fail over. */
async function fromMirrors<T>(path: string, init?: RequestInit): Promise<T> {
  let last: unknown;
  for (const m of MIRRORS) {
    try { return await getJson<T>(`${m}${path}`, init); } catch (e) { last = e; }
  }
  throw new Error(`Radio Browser unreachable (${(last as Error)?.message ?? "no mirror"})`);
}

const NEWS_RE = /news|khabar|samachar|talk|public|radio nepal|bbc/i;
const LOCAL_RE = /kathmandu|lalitpur|bhaktapur|patan|bagmati/i;

export function normalize(rows: Raw[]): Station[] {
  const seen = new Set<string>();
  const out: Station[] = [];
  for (const r of rows) {
    if (!r || typeof r.stationuuid !== "string" || !UUID_RE.test(r.stationuuid)) continue;
    let url: URL;
    try { url = new URL(r.url_resolved); } catch { continue; }
    // Browser-playable only: HTTPS (no mixed content), not HLS, MP3/AAC, passing the directory's own health check.
    if (url.protocol !== "https:" || r.hls === 1 || r.lastcheckok !== 1 || !/^(mp3|aac\+?)$/i.test(r.codec ?? "")) continue;
    const name = String(r.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    const key = `${name.toLowerCase()}|${url.host}`;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const lat = typeof r.geo_lat === "number" ? r.geo_lat : null, lon = typeof r.geo_long === "number" ? r.geo_long : null;
    const distKm = lat !== null && lon !== null ? Math.round(Math.hypot((lon - VALLEY_C[0]) * 98.6, (lat - VALLEY_C[1]) * 110.6) * 10) / 10 : null;
    const tags = String(r.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 6);
    const text = `${name} ${tags.join(" ")}`;
    let homepage: string | null = null;
    try { const h = new URL(r.homepage); if (h.protocol === "https:" || h.protocol === "http:") homepage = h.toString(); } catch { /* none */ }
    out.push({
      id: r.stationuuid.toLowerCase(), name, url: url.toString(), homepage, codec: r.codec.toUpperCase(), bitrate: Number(r.bitrate) || 0,
      tags, language: String(r.language ?? "").slice(0, 40), state: String(r.state ?? "").slice(0, 40), lat, lon, distKm,
      inValley: distKm !== null && distKm <= 18, news: NEWS_RE.test(text), local: (distKm !== null && distKm <= 18) || LOCAL_RE.test(`${text} ${r.state}`),
      clicks: Number(r.clickcount) || 0, votes: Number(r.votes) || 0,
    });
  }
  // News first (that's what an EOC listens to), then valley stations, then popularity.
  return out.sort((a, b) => Number(b.news) - Number(a.news) || Number(b.local) - Number(a.local) || b.clicks - a.clicks || a.name.localeCompare(b.name));
}

let mem: { at: number; dir: RadioDirectory } | null = null;
let failedAt = 0;
let inflight: Promise<RadioDirectory> | null = null;

async function readDisk(): Promise<{ at: number; dir: RadioDirectory } | null> {
  try {
    const dir = JSON.parse(await readFile(CACHE_FILE, "utf8")) as RadioDirectory;
    return { at: Date.parse(dir.retrievedAt) || 0, dir };
  } catch { return null; }
}

export async function radioStations(): Promise<RadioDirectory> {
  mem ??= await readDisk();
  const age = mem ? Date.now() - mem.at : Infinity;
  if (mem && age < FRESH_MS) return mem.dir;
  if (mem && Date.now() - failedAt < FAIL_BACKOFF_MS && age < STALE_MS) return { ...mem.dir, stale: true };
  inflight ??= (async () => {
    try {
      const rows = await fromMirrors<Raw[]>(`/json/stations/search?countrycode=${COUNTRY}&hidebroken=true&order=clickcount&reverse=true&limit=300`);
      if (!Array.isArray(rows)) throw new Error("directory returned no list");
      const stations = normalize(rows);
      if (!stations.length) throw new Error("no playable stations");
      const dir: RadioDirectory = {
        source: "Radio Browser (radio-browser.info)", licence: "Directory data: public domain (PDDL 1.0). Each broadcaster's stream terms apply.",
        note: "Live broadcast radio, today. Not part of the 2024 replay. Audio plays straight from each broadcaster; StormAhead does not record or transcribe it.",
        retrievedAt: new Date().toISOString(), stale: false, stations,
      };
      mem = { at: Date.now(), dir };
      await mkdir(dirname(CACHE_FILE), { recursive: true }).catch(() => {});
      await writeFile(CACHE_FILE, JSON.stringify(dir)).catch(() => {});
      return dir;
    } catch (e) {
      failedAt = Date.now();
      if (mem && Date.now() - mem.at < STALE_MS) return { ...mem.dir, stale: true };
      throw e;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Count a play in the directory (it ranks stations by clicks). Only for stations in our own list. */
export async function radioClick(id: string): Promise<boolean> {
  const known = mem?.dir.stations.some((s) => s.id === id.toLowerCase());
  if (!known || !UUID_RE.test(id)) return false;
  try { await fromMirrors(`/json/url/${id.toLowerCase()}`); return true; } catch { return false; }
}
