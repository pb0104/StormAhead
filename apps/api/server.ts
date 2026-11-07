import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z, ZodError } from "zod";
import { HttpError } from "./common.ts";
import { getServices } from "./composition.ts";
import { HindcastService } from "./hindcast.ts";
import { HeleneService } from "./helene.ts";
import compress from "@fastify/compress";

export async function buildServer() {
  const app = Fastify({ logger: false });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: "Invalid input", issues: err.issues });
    return reply.code(err.statusCode ?? 500).send({ error: err.message ?? "Internal error" });
  });

  await app.register(compress);
  app.get("/api/health", async () => ({ ok: true }));

  const S = () => getServices();

  app.get("/api/scene", async () => S().scene.load());

  // --- Gemini on Vertex AI -------------------------------------------------
  // Status is free: it checks the credential without calling a model, so the team can confirm their ADC setup
  // without spending anything. Generation is OFF unless LLM_ADAPTER=vertex, and rate-limited in LlmService.
  app.get("/api/llm/status", async () => S().llm.status());
  app.post("/api/llm/generate", async (req) => {
    const b = z.object({
      prompt: z.string().min(1),
      system: z.string().optional(),
      maxOutputTokens: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
    }).parse(req.body ?? {});
    try {
      return await S().llm.generate(b);
    } catch (err) {
      // Google's auth errors are long and mention neither the fix nor the policy, so re-frame them.
      const m = (err as Error).message ?? "";
      if (/rate limit/i.test(m)) throw new HttpError(429, m);
      if (/could not load the default credentials|ADC|credential/i.test(m)) {
        throw new HttpError(503, `Vertex AI is not authenticated: ${m}. Run \`gcloud auth application-default login\`. See GET /api/llm/status.`);
      }
      if (/permission|403|IAM/i.test(m)) {
        throw new HttpError(403, `Vertex AI refused the call: ${m}. You likely need roles/aiplatform.user on the project, and the Vertex AI API enabled.`);
      }
      throw new HttpError(502, m || "Vertex AI call failed");
    }
  });

  app.get("/api/weather/seed", async () => S().weatherSeed.seed());

  /** Cloud cover + MSL pressure bands (Kathmandu). Disk-cached under data/cache/weather/. */
  app.get("/api/weather/atmosphere", async (req) => {
    const raw = (req.query as { refresh?: string } | undefined)?.refresh;
    const refresh = raw === "1" || raw === "true";
    return S().atmosphere.load({ refresh });
  });

  /** Real OSM critical assets (hospitals, dams, schools, airports, towers, shelters). Cached under data/cache/osm/. */
  app.get("/api/assets", async (req) => {
    const raw = (req.query as { refresh?: string } | undefined)?.refresh;
    const refresh = raw === "1" || raw === "true";
    return S().assets.load({ refresh });
  });

  app.get("/api/assessment", async (req) => {
    const q = z.object({
      rainIn: z.coerce.number().min(0).max(40).default(10),
      stage: z.coerce.number().int().min(1).max(3).default(3),
    }).parse(req.query);
    return S().assessment.run(q.rainIn, q.stage);
  });

  app.get("/api/tiles/esri/:z/:y/:x", async (req, reply) => {
    const p = z.object({ z: z.coerce.number(), y: z.coerce.number(), x: z.coerce.number() }).parse(req.params);
    const t = await S().tiles.getEsri(p.z, p.y, p.x);
    reply.header("Content-Type", t.contentType);
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("X-Cache", t.cacheHit ? "HIT" : "MISS");
    return reply.send(t.body);
  });

  app.get("/api/tiles/terrarium/:z/:x/:y", async (req, reply) => {
    const p = z.object({ z: z.coerce.number(), x: z.coerce.number(), y: z.string() }).parse(req.params);
    const y = Number(String(p.y).replace(/\.png$/i, ""));
    const t = await S().tiles.getTerrarium(p.z, p.x, y);
    reply.header("Content-Type", t.contentType || "image/png");
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("X-Cache", t.cacheHit ? "HIT" : "MISS");
    return reply.send(t.body);
  });

  /** Photoreal / Cesium ion proxy. Pass full upstream URL as ?u= */
  app.get("/api/tiles/cesium", async (req, reply) => {
    const q = z.object({ u: z.string().url() }).parse(req.query);
    const token = process.env.CESIUM_ION_TOKEN ?? "";
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const key = q.u.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._/-]/g, "_").slice(0, 200);
    const t = await S().tiles.getCesium(q.u, key, headers);
    reply.header("Content-Type", t.contentType);
    reply.header("Cache-Control", "public, max-age=86400");
    reply.header("X-Cache", t.cacheHit ? "HIT" : "MISS");
    reply.header("Access-Control-Allow-Origin", "*");
    return reply.send(t.body);
  });

  // Hurricane Helene replay (western NC): reported road restrictions on a pre-storm network.
  let hel: HeleneService | null = null;
  const HL = () => {
    if (hel) return hel;
    if (!HeleneService.available()) throw new HttpError(404, "Helene dataset not prepared. Run scripts/fetch_tims.mjs then scripts/prepare_helene.py (see docs/helene-data-audit.md).");
    return (hel = new HeleneService());
  };
  app.get("/api/helene/meta", async () => (HeleneService.available() ? HL().meta() : { available: false }));
  app.get("/api/helene/roads", async () => HL().roads());
  app.get("/api/helene/closures", async () => ({ closures: HL().closuresList() }));

  // Kathmandu hindcast (real data): observed flood is a given input; impacts predicted; scored against incident reports.
  let hind: HindcastService | null = null;
  const H = () => {
    if (hind) return hind;
    if (!HindcastService.available()) throw new HttpError(404, "Kathmandu dataset not prepared. Run scripts/prepare_kathmandu.py (see docs/real-data-findings.md).");
    return (hind = new HindcastService());
  };
  app.get("/api/hindcast/meta", async () => (HindcastService.available() ? H().meta() : { available: false }));
  // Per-agent evaluation of the real engine against withheld incident reports. Fast (no sensitivity sweeps), cached.
  app.get("/api/scorecard", async () => {
    const s = H().scorecard();
    if (!s) throw new HttpError(404, "Ward layer not prepared. Run scripts/fetch_wards.mjs.");
    return s;
  });
  // The scorecard as geography: wards coloured by hit / false alarm / miss, plus the incident points.
  app.get("/api/verification", async (_req, reply) => {
    const v = H().verificationGeo();
    if (!v) throw new HttpError(404, "Ward layer not prepared. Run scripts/fetch_wards.mjs.");
    return reply.header("cache-control", "public, max-age=3600").send(v);
  });
  // Real pre-event building footprints for the console's shelter layer. 404 when the layer was never fetched,
  // so the console simply renders without it.
  app.get("/api/buildings", async (_req, reply) => {
    const b = H().buildingsGeo();
    if (!b) throw new HttpError(404, "Building layer not prepared. Run scripts/fetch_buildings.mjs.");
    return reply.header("cache-control", "public, max-age=3600").send(b);
  });
  app.get("/api/hindcast/geo", async () => H().geo());
  app.post("/api/hindcast/run", async (req) => {
    const b = z.object({ closeShare: z.number().optional(), bridgeClosesOnAnyContact: z.boolean().optional(), degradeMinutes: z.number().optional(), degradeRatio: z.number().optional() }).parse(req.body ?? {});
    return H().run(b);
  });

  const dist = fileURLToPath(new URL("../web/dist", import.meta.url));
  if (existsSync(dist)) app.register(fastifyStatic, { root: dist });
  return app;
}
