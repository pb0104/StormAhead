import { areaAt } from "./forecast/area.ts";
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
import { PipelineService } from "./pipeline.ts";
import { radioClick, radioStations } from "./radio.ts";
import { googleAttribution, googleStatus, googleTile, TileError } from "./googleTiles.ts";
import { coverageAt, deleteAction, listActions, locations, nextRecommendation, parseUpdate, saveActions, searchPlaces, updateAction } from "./actions/actions.ts";
import { factorList, parseIntent, runForecast, type ForecastEvent } from "./forecast/service.ts";
import { registerLiveVoice } from "./voice/liveProxy.ts";

export async function buildServer() {
  const app = Fastify({ logger: false });
  await registerLiveVoice(app);

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: "Invalid input", issues: err.issues });
    return reply.code(err.statusCode ?? 500).send({ error: err.message ?? "Internal error" });
  });

  await app.register(compress);
  app.get("/api/health", async () => ({ ok: true }));

  const S = () => getServices();

  app.get("/api/scene", async () => S().scene.load());

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

  // Google 2D satellite tiles (higher resolution base imagery). Key stays server-side; memory-cached only, per Google's terms.
  app.get("/api/tiles/google/status", async () => googleStatus());
  app.get("/api/tiles/google/attribution", async (req) => {
    const q = z.object({ zoom: z.coerce.number().min(0).max(22), n: z.coerce.number(), s: z.coerce.number(), e: z.coerce.number(), w: z.coerce.number() }).parse(req.query);
    try { return { copyright: await googleAttribution(q.zoom, q.n, q.s, q.e, q.w) }; }
    catch (e) { throw new HttpError(e instanceof TileError ? e.status : 502, (e as Error).message); }
  });
  app.get("/api/tiles/google/:z/:x/:y", async (req, reply) => {
    const p = z.object({ z: z.coerce.number().int(), x: z.coerce.number().int(), y: z.coerce.number().int() }).parse(req.params);
    try {
      const t = await googleTile(p.z, p.x, p.y);
      reply.header("Content-Type", t.type);
      reply.header("Cache-Control", "private, max-age=86400");
      reply.header("X-Cache", t.hit ? "HIT" : "MISS");
      return reply.send(t.body);
    } catch (e) {
      throw new HttpError(e instanceof TileError ? e.status : 502, (e as Error).message);
    }
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

  // Forward pipeline: gauges + terrain -> ward risk -> roads at risk -> alert drafts. Nothing here uses post-event imagery.
  let pipe: PipelineService | null = null;
  const P = () => {
    if (pipe) return pipe;
    if (!PipelineService.available()) throw new HttpError(404, "Pipeline inputs not prepared. See docs/pipeline.md.");
    return (pipe = new PipelineService());
  };
  app.get("/api/pipeline/meta", async () => (PipelineService.available() ? P().meta() : { available: false }));
  app.get("/api/pipeline/geo", async () => P().geo());
  app.post("/api/pipeline/run", async (req) => {
    const b = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body ?? {});
    return P().run(b.date);
  });

  // Live broadcast radio: the station LIST only (Radio Browser, cached). Audio streams browser → broadcaster, never via us.
  app.get("/api/radio/stations", async (_req, reply) => {
    try { return reply.header("cache-control", "public, max-age=300").send(await radioStations()); }
    catch (e) { throw new HttpError(503, (e as Error).message); }
  });
  app.post("/api/radio/click/:id", async (req) => {
    const p = z.object({ id: z.string().uuid() }).parse(req.params);
    return { counted: await radioClick(p.id) };
  });

  // Place search for navigation (ORACLE "fly me to X"): OSM places, wards, open spaces, facilities, named buildings.
  app.get("/api/places/search", async (req) => {
    const q = z.object({ q: z.string().trim().min(1).max(80) }).parse(req.query);
    return searchPlaces(q.q);
  });

  // Analyst action updates: a typed sentence → structured actions (LLM) → confirmed → saved to the location's history.
  const resolved = z.object({ name: z.string().max(200), lon: z.number().min(85.2).max(85.6), lat: z.number().min(27.5).max(27.9), kind: z.string().max(40) }).nullable();
  const draft = z.object({
    kind: z.enum(["dispatch", "evacuate", "supply", "shelter", "rescue", "alert", "road", "other"]), resource: z.string().max(60).nullable(),
    people: z.number().int().min(0).max(1_000_000).nullable(), summary: z.string().max(120), placeText: z.string().max(80).nullable(),
    destText: z.string().max(80).nullable(), place: resolved, dest: resolved,
  });
  const actionsView = () => ({ items: listActions(), locations: locations(), next: nextRecommendation() });
  app.get("/api/actions", async () => actionsView());
  app.post("/api/actions/parse", async (req) => {
    const b = z.object({ text: z.string().trim().min(3).max(600) }).parse(req.body ?? {});
    return parseUpdate(b.text);
  });
  app.post("/api/actions", async (req) => {
    const b = z.object({ text: z.string().max(600), by: z.enum(["stackai", "rules"]), actions: z.array(draft).min(1).max(6) }).parse(req.body ?? {});
    const saved = saveActions(b.text, b.actions, b.by);
    const at = saved.find((a) => a.place)?.place ?? null;
    return { ...actionsView(), saved, followup: nextRecommendation(at), coverage: at ? coverageAt(at.lon, at.lat) : null };
  });
  // Live coverage for the places a forecast flagged, so the priority list updates as actions are logged.
  app.post("/api/actions/coverage", async (req) => {
    const b = z.object({ points: z.array(z.object({ id: z.string().max(80), lon: z.number(), lat: z.number() })).max(200) }).parse(req.body ?? {});
    return Object.fromEntries(b.points.map((p) => [p.id, coverageAt(p.lon, p.lat)]));
  });
  // Edit an action (the console and ORACLE use this). Changed place names are re-matched; unknown names are refused.
  app.patch("/api/actions/:id", async (req) => {
    const p = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({
      kind: draft.shape.kind.optional(), resource: z.string().max(60).nullable().optional(), people: z.number().int().min(0).max(1_000_000).nullable().optional(),
      placeText: z.string().max(80).nullable().optional(), destText: z.string().max(80).nullable().optional(), summary: z.string().max(120).optional(),
    }).parse(req.body ?? {});
    const r = updateAction(p.id, b);
    if (!r.ok) throw new HttpError(r.error.startsWith("No such") ? 404 : 422, r.error);
    return { ...actionsView(), item: r.item };
  });
  app.delete("/api/actions/:id", async (req) => {
    const p = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!deleteAction(p.id)) throw new HttpError(404, "No such action");
    return actionsView();
  });

  // Forecast console: question → factors → parallel agents (streamed as server-sent events) → fusion → LLM report.
  app.get("/api/forecast/factors", async () => factorList());
  app.get("/api/forecast/area", async (req) => {
    const q = z.object({ lon: z.coerce.number().min(-180).max(180), lat: z.coerce.number().min(-90).max(90) }).parse(req.query ?? {});
    return areaAt(S(), q.lon, q.lat);
  });
  app.post("/api/forecast/intent", async (req) => {
    const b = z.object({ question: z.string().min(1).max(500) }).parse(req.body ?? {});
    return parseIntent(b.question);
  });
  app.post("/api/forecast/run", async (req, reply) => {
    const b = z.object({ question: z.string().min(1).max(500), hours: z.number().min(6).max(24 * 30).optional(), factors: z.array(z.string()).max(20).optional() }).parse(req.body ?? {});
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    let closed = false;
    res.on("close", () => { closed = true; });
    const emit = (e: ForecastEvent) => { if (!closed) res.write(`data: ${JSON.stringify(e)}\n\n`); };
    try {
      await runForecast(S(), b, emit, () => closed);
    } catch (e) {
      emit({ type: "error", message: (e as Error).message });
    } finally {
      res.end();
    }
  });

  const dist = fileURLToPath(new URL("../web/dist", import.meta.url));
  if (existsSync(dist)) app.register(fastifyStatic, { root: dist });
  return app;
}
