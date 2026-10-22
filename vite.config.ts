import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: { include: ["exifr", "@jsquash/avif/codec/enc/avif_enc.js"] },
  worker: { format: "es" },
  server: { port: 5173, strictPort: true },
});
