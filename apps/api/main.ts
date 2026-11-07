// Keys (STACKAI_*, GOOGLE_*) live in the repo-root .env. Node loads it natively; a missing file is fine.
try { process.loadEnvFile(new URL("../../.env", import.meta.url)); } catch { /* no .env: every key is optional */ }
import { buildServer } from "./server.ts";

const port = Number(process.env.PORT ?? 3001);
const app = await buildServer();
await app.listen({ port, host: "127.0.0.1" });
console.log(`StormAhead on http://127.0.0.1:${port}  (ops console + Helene + hindcast; WEATHER_ADAPTER=${process.env.WEATHER_ADAPTER ?? "openmeteo"})`);
