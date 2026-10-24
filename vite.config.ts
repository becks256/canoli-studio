import { defineConfig } from "vite";

export default defineConfig({
  // These worker-only imports are discovered after startup otherwise; a cache
  // containing the earlier aggregate CSS parser can force a mid-import reload.
  optimizeDeps: { include: ["exifr", "@jsquash/avif/codec/enc/avif_enc.js", "@xmldom/xmldom", "css-tree/parser", "css-tree/walker", "css-tree/generator", "css-tree/utils"] },
  worker: { format: "es" },
  server: { port: 5173, strictPort: true },
});
