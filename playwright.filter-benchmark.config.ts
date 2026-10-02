import { defineConfig } from "@playwright/test";
import base from "./playwright.benchmark.config";
export default defineConfig({
  ...base,
  testMatch: "**/filter-mask.bench.ts",
  timeout: 300_000,
});
