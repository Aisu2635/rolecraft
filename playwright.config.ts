import { defineConfig, devices } from "@playwright/test";

// 4173 by default; E2E_PORT moves it when another app already holds that port (reuseExistingServer would use it).
const port = Number(process.env.E2E_PORT ?? 4173);
const baseURL = `http://localhost:${port}`;

// Chromium only, here and in CI (`npx playwright install --with-deps chromium`).
export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
