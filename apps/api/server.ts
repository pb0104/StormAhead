import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z, ZodError } from "zod";
import { HttpError } from "./common.ts";
import { HindcastService } from "./hindcast.ts";

export function buildServer() {
  const app = Fastify({ logger: false });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: "Invalid input", issues: err.issues });
    return reply.code(err.statusCode ?? 500).send({ error: err.message ?? "Internal error" });
  });

  app.get("/api/health", async () => ({ ok: true }));

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
