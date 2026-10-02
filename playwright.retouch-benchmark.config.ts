import { defineConfig } from "@playwright/test";
import base from "./playwright.benchmark.config";
export default defineConfig({
  ...base,
  testMatch: "**/retouch.bench.ts",
  timeout: 300_000,
});
