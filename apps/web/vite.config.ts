import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root,
  // Keys live in the repo-root .env. Vite exposes only VITE_* names to the browser (e.g. VITE_GOOGLE_MAPS_API_KEY);
  // everything else there (STACKAI_API_KEY, ...) stays server-side.
  envDir: repoRoot,
  plugins: [
    react(),
    {
      name: "geojson-as-json",
      transform(src, id) {
        if (!(id.split("?")[0] ?? "").endsWith(".geojson")) return;
        return { code: `export default ${src}`, map: null };
      },
    },
  ],
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
    // API_TARGET lets a second copy run against another API port (default: the usual :3001).
    // ws: true keeps Gemini Live (ORACLE) working through the Vite proxy when not on localhost direct.
    proxy: { "/api": { target: process.env.API_TARGET ?? "http://127.0.0.1:3001", changeOrigin: true, ws: true } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
