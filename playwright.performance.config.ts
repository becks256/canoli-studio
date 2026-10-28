import { defineConfig } from '@playwright/test';
import production from './playwright.production.config';

/** Run against `VITE_BENCHMARK=1 npm run build` output; keep dev-only module imports out of these tests. */
export default defineConfig({
  ...production,
  testMatch: ['**/float-interaction-latency.e2e.ts', '**/font-management-latency.e2e.ts', '**/filter-mask-latency.e2e.ts', '**/workspace-save-latency.e2e.ts', '**/path-handle-latency.e2e.ts', '**/project-open-latency.e2e.ts', '**/recovery-restore-latency.e2e.ts', '**/recovery-list-latency.e2e.ts', '**/recovery-latency.e2e.ts', '**/raster-inspector-latency.e2e.ts', '**/inspector-rotation-latency.e2e.ts', '**/move-document-latency.e2e.ts', '**/vector-construction-latency.e2e.ts', '**/render-cancellation-latency.e2e.ts', '**/color-latency.e2e.ts', '**/script-transport-latency.e2e.ts', '**/script-runtime-phases.e2e.ts', '**/document-operations-latency.e2e.ts', '**/pen-latency.e2e.ts', '**/large-clone-latency.e2e.ts', '**/transform-latency.e2e.ts', '**/document-switch-latency.e2e.ts', '**/retouch-latency.e2e.ts', '**/sustained-paint.e2e.ts', '**/paint-latency.e2e.ts', '**/routine-latency.e2e.ts', '**/pixel-operation-latency.e2e.ts', '**/mixed-session-latency.e2e.ts', '**/deep-history-latency.e2e.ts', '**/text-vector-latency.e2e.ts', '**/large-image-latency.e2e.ts'],
});
