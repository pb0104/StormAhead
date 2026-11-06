import { fileURLToPath } from "node:url";
import { buildServer } from "./server.ts";
import { CascadeService } from "./service.ts";

const dbPath = process.env.CASCADEIQ_DB ?? fileURLToPath(new URL("../../data/cascadeiq.sqlite", import.meta.url));
const port = Number(process.env.PORT ?? 3001);
const stepDelayMs = Number(process.env.DEMO_STEP_DELAY_MS ?? 250);

const service = new CascadeService({ dbPath });
const app = buildServer(service, { stepDelayMs });
await app.listen({ port, host: "127.0.0.1" });
console.log(`CascadeIQ API on http://127.0.0.1:${port}  (synthetic data, no API keys required)`);
