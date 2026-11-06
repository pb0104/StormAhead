import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z, ZodError } from "zod";
import { TemporalLeakError, findExposedAssets } from "../../packages/analysis/index.ts";
import { PlanningInputs } from "../../packages/shared/schemas.ts";
import { CascadeService, HttpError } from "./service.ts";

export function buildServer(service: CascadeService, opts: { stepDelayMs?: number } = {}) {
  const app = Fastify({ logger: false });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: "Invalid input", issues: err.issues });
    if (err instanceof TemporalLeakError) return reply.code(422).send({ error: err.message });
    return reply.code(err.statusCode ?? 500).send({ error: err.message ?? "Internal error" });
  });

  app.get("/api/health", async () => ({ ok: true, simulated: true }));
  app.get("/api/dataset", async () => ({ dataset: service.dataset, source: "synthetic", ...service.getInputs() }));
  app.get("/api/exposure", async () => Object.fromEntries(service.dataset.hazards.map((h) => [h.id, findExposedAssets(service.dataset, h.id)])));
  app.get("/api/inputs", async () => service.getInputs());
  app.put("/api/inputs", async (req) => service.setInputs(PlanningInputs.partial().parse(req.body)));
  app.post("/api/reset", async () => (service.reset(), { ...service.getInputs() }));

  app.post("/api/plan", async () => service.generate(opts.stepDelayMs ?? 0));
  app.get("/api/runs/latest", async () => ({ run: service.latestRun() }));

  const Review = z.object({
    decision: z.enum(["approve", "request_revision", "reject"]),
    reviewer: z.string().min(1),
    planId: z.string().optional(),
    notes: z.string().optional(),
  });
  app.post<{ Params: { id: string } }>("/api/runs/:id/review", async (req) => {
    const b = Review.parse(req.body);
    return service.review(req.params.id, b.decision, b.reviewer, b.planId, b.notes);
  });
  app.post<{ Params: { id: string } }>("/api/runs/:id/assignments", async (req) => ({ actions: service.createAssignments(req.params.id) }));
  app.get("/api/inbox", async () => ({ actions: service.listActions() }));
  app.get("/api/evaluation", async () => service.evaluationView());

  // Server-sent events: real agent tool events + run status changes.
  app.get("/api/events", (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": connected\n\n");
    const send = (name: string) => (data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    const a = send("agent-event"), b = send("run-status");
    service.bus.on("agent-event", a);
    service.bus.on("run-status", b);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.raw.on("close", () => { clearInterval(ping); service.bus.off("agent-event", a); service.bus.off("run-status", b); });
  });

  const dist = fileURLToPath(new URL("../web/dist", import.meta.url));
  if (existsSync(dist)) app.register(fastifyStatic, { root: dist });
  return app;
}
