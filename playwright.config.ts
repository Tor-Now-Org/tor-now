import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the whole system: a throwaway Postgres, the real
 * API served by Node, and the built interface. Nothing is stubbed, and nothing
 * touches the deployed environment — scripts/e2e.sh brings the stack up.
 *
 * Two viewports. The phone is the design's centre of gravity and every
 * journey runs there; the desktop project runs the same journeys against the
 * wider layout, where the navigation is a side rail rather than a bottom bar.
 * A test that passes on one and fails on the other is the point of having both.
 */
const BASE_URL = process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: false,
  forbidOnly: process.env["CI"] === "true",
  retries: process.env["CI"] === "true" ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env["CI"] === "true" ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], baseURL: BASE_URL },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: BASE_URL,
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
