import { defineConfig, devices } from "@playwright/test";

// The Makefile prepares the database and builds the application first
// (`make e2e`); this file only starts the built server and runs the scenarios.
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e/acceptance",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "ru-RU",
    trace: "retain-on-failure",
  },
  // The sign-in endpoint allows three attempts per ten seconds from one client.
  // The sign-in scenario uses all three, so it runs first; the setup then signs
  // each teacher in once and every other scenario reuses those sessions
  // (e2e/acceptance/sessions.ts).
  projects: [
    { name: "sign-in", testMatch: "teacher-sign-in.spec.ts", use: { ...devices["Desktop Chrome"] } },
    { name: "sessions", testMatch: /\.setup\.ts$/, dependencies: ["sign-in"] },
    {
      name: "chromium",
      testIgnore: ["teacher-sign-in.spec.ts", /\.setup\.ts$/],
      dependencies: ["sessions"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run start -w app -- --port ${port}`,
    url: `${baseURL}/api/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
