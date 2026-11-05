import { defineConfig } from "@playwright/test";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import base from "./playwright.config";

const root = dirname(fileURLToPath(import.meta.url));
const sourceFiles = [
  "font-decode.e2e.ts",
  "css-font-instance.e2e.ts",
  "font-shaping.e2e.ts",
  "font-source.e2e.ts",
  "native-text-plan.e2e.ts",
  "native-glyph.e2e.ts",
  "font-variations.e2e.ts",
  "optical-font.e2e.ts",
  "native-svg-glyph.e2e.ts",
  "native-svg-path.e2e.ts",
  "text-path.e2e.ts",
  "text-path-large.e2e.ts",
  "native-svg-vertical.e2e.ts",
  "native-svg-vertical-reference.e2e.ts",
  "vertical-layout.e2e.ts",
  "vertical-writing.e2e.ts",
  "vertical-ui.e2e.ts",
  "vertical-large.e2e.ts",
  "native-svg-styled.e2e.ts",
  "native-svg-styled-paint.e2e.ts",
  "native-text-items.e2e.ts",
  "native-text-paint.e2e.ts",
  "native-styled-bidi.e2e.ts",
  "native-styled-bidi-paint.e2e.ts",
  "native-font-fallback-lifetime.e2e.ts",
  "native-svg-inline.e2e.ts",
  "native-layout-size.e2e.ts",
  "native-svg-span-frames.e2e.ts",
  "native-svg-span-lifetime.e2e.ts",
  "native-svg-span-paint.e2e.ts",
  "float-text-ui.e2e.ts",
  "float-text-connection.e2e.ts",
  "float-text-cache.e2e.ts",
  "float-text-workflow.e2e.ts",
  "native-svg-context.e2e.ts",
  "native-curved-span-paint.e2e.ts",
  "native-parent.e2e.ts",
  "native-vertical-parent.e2e.ts",
  "native-horizontal-origin.e2e.ts",
  "native-parent-guards.e2e.ts",
  "native-parent-authored-guards.e2e.ts",
  "native-parent-paint.e2e.ts",
  "native-fallback-baseline-guards.e2e.ts",
];
const legacyFiles = [
  "float-white-balance.e2e.ts",
  "float-color.e2e.ts",
  "float-blend.e2e.ts",
  "float-palette.e2e.ts",
];
const fallbackFiles = [
  "native-font-fallback.e2e.ts",
  "native-font-fallback-paint.e2e.ts",
];

// These are canonical filenames, not optional globs. A renamed reference must
// fail discovery instead of silently removing part of the acceptance corpus.
for (const name of [...sourceFiles, ...legacyFiles, ...fallbackFiles]) {
  const path = join(root, "tests", name);
  let present = false;
  try {
    present = statSync(path).isFile();
  } catch {
    // Report the missing canonical selection with the same actionable error.
  }
  if (!present)
    throw new Error(`Native text acceptance file is missing: ${path}`);
}

export default defineConfig({
  ...base,
  testDir: join(root, "tests"),
  outputDir: join(root, "test-results", "native-text"),
  testIgnore: [],
  timeout: 180_000,
  projects: [
    { name: "source", testMatch: sourceFiles },
    { name: "source legacy", testMatch: legacyFiles, grep: /isolated/ },
    { name: "fallback", testMatch: fallbackFiles },
  ],
  use: { ...base.use, baseURL: "http://127.0.0.1:5187" },
  webServer: {
    command: "npm run dev -- --port 5187 --strictPort",
    cwd: root,
    url: "http://127.0.0.1:5187",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
