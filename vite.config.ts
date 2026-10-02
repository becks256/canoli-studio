import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: { include: ["exifr"] },
  worker: { format: "es" },
  server: { port: 5173, strictPort: true },
});
