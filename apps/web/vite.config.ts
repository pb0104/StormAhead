import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  root,
  plugins: [
    react(),
    {
      name: "geojson-as-json",
      transform(src, id) {
        if (!id.split("?")[0].endsWith(".geojson")) return;
        return { code: `export default ${src}`, map: null };
      },
    },
  ],
  server: {
    port: 5173,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
    proxy: { "/api": { target: "http://127.0.0.1:3001", changeOrigin: true } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
