import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: "**/performance.bench.ts",
  testIgnore: [],
  workers: 1,
  retries: 0,
  timeout: 180_000,
  use: { ...base.use, baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "npm run preview",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
