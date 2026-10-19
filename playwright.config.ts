import { defineConfig, devices } from "@playwright/test";

const useProductionBuild = process.env.PLAYWRIGHT_USE_BUILD === "true";
const defaultPort = useProductionBuild ? 4473 : 5473;
const port = Number(process.env.PLAYWRIGHT_PORT ?? defaultPort);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: process.env.CI
    ? [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
    : [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    env: {
      VITE_USE_MOCK_API: "true",
      VITE_CONVEX_URL: "https://e2e-mock.invalid.convex.cloud",
      PLAYWRIGHT_PORT: String(port),
      PLAYWRIGHT_HOST: "127.0.0.1",
    },
    command: useProductionBuild
      ? `node scripts/e2e-preview-server.mjs`
      : `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
