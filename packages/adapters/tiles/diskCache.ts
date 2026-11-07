import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_CACHE_ROOT = fileURLToPath(new URL("../../../data/cache/", import.meta.url));

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class DiskTileCache {
  mem = new Map<string, { body: Buffer; contentType: string }>();
  fetchCount = 0;

  constructor(
    public root = DEFAULT_CACHE_ROOT,
    public fetchImpl: FetchFn = globalThis.fetch.bind(globalThis),
  ) {}

  pathFor(ns: string, key: string) {
    const safe = key.replace(/[^a-zA-Z0-9._/-]/g, "_");
    return join(this.root, ns, safe);
  }

  async get(ns: string, key: string, upstreamUrl: string, headers?: Record<string, string>): Promise<{ body: Buffer; contentType: string; cacheHit: boolean }> {
    const memKey = `${ns}:${key}`;
    const hit = this.mem.get(memKey);
    if (hit) return { ...hit, cacheHit: true };

    const path = this.pathFor(ns, key);
    if (existsSync(path)) {
      const body = readFileSync(path);
      const metaPath = path + ".meta.json";
      const contentType = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, "utf8")).contentType as string) : "application/octet-stream";
      const entry = { body, contentType };
      this.mem.set(memKey, entry);
      return { ...entry, cacheHit: true };
    }

    this.fetchCount += 1;
    const res = await this.fetchImpl(upstreamUrl, { headers });
    if (!res.ok) throw new Error(`tile upstream ${res.status} for ${upstreamUrl}`);
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const body = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    writeFileSync(path + ".meta.json", JSON.stringify({ contentType, upstreamUrl }));
    const entry = { body, contentType };
    this.mem.set(memKey, entry);
    return { ...entry, cacheHit: false };
  }
}

export const hashKey = (s: string) => createHash("sha1").update(s).digest("hex");
