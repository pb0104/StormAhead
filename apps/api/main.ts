import { buildServer } from "./server.ts";

const port = Number(process.env.PORT ?? 3001);
const app = buildServer();
await app.listen({ port, host: "127.0.0.1" });
console.log(`CascadeIQ on http://127.0.0.1:${port}  (ops console + adapters; WEATHER_ADAPTER=${process.env.WEATHER_ADAPTER ?? "openmeteo"})`);
