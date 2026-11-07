import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z, ZodError } from "zod";
import { HttpError } from "./common.ts";
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
  app.get("/api/hindcast/geo", async () => H().geo());
  app.post("/api/hindcast/run", async (req) => {
    const b = z.object({ closeShare: z.number().optional(), bridgeClosesOnAnyContact: z.boolean().optional(), degradeMinutes: z.number().optional(), degradeRatio: z.number().optional() }).parse(req.body ?? {});
    return H().run(b);
  });

  const dist = fileURLToPath(new URL("../web/dist", import.meta.url));
  if (existsSync(dist)) app.register(fastifyStatic, { root: dist });
  return app;
}
