import { defineConfig, devices } from "@playwright/test";

// Browser checks for dev pages: `pnpm test:e2e`. Not part of CI; run where Chromium is installed
// (`pnpm exec playwright install chromium` once on a new machine).
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  // Screenshot baselines (shots.e2e.ts) are renders of the ROM's graphics: kept out of git, and
  // per platform since renderers differ.
  snapshotPathTemplate: "{testDir}/baselines/{platform}/{arg}{ext}",
  use: { baseURL: "http://localhost:5173" },
  webServer: { command: "pnpm dev --port 5173 --strictPort", url: "http://localhost:5173", reuseExistingServer: true },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: "*.touch.e2e.ts" },
    { name: "touch", use: { ...devices["Pixel 7"] }, testMatch: "*.touch.e2e.ts" },
  ],
});
