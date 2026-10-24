import { defineConfig } from "@playwright/test";
import { statfsSync } from "node:fs";
import { tmpdir } from "node:os";

// Chromium's redirected shared-memory files can exhaust a tight temporary disk
// during source-module reloads. Prefer /dev/shm only when it has more room;
// small Docker shared-memory mounts and other platforms retain the default.
function chromiumSharedMemoryAvailable() {
  if (process.platform !== "linux") return false;
  try {
    const shared = statfsSync("/dev/shm", { bigint: true });
    const temporary = statfsSync(tmpdir(), { bigint: true });
    return shared.bavail * shared.bsize > temporary.bavail * temporary.bsize;
  } catch {
    return false;
  }
}

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  testIgnore: "**/production.e2e.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    actionTimeout: 10_000,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      ignoreDefaultArgs: chromiumSharedMemoryAvailable()
        ? ["--disable-dev-shm-usage"]
        : undefined,
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
