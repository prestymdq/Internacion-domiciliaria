import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

const webServer =
  process.env.E2E_WEB_SERVER === "1"
    ? {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120000,
      }
    : undefined;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer,
});
