import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Only the Playwright-launched server gets the debug DOM mirror — a
    // developer's own `npm run dev` doesn't set this, so casual local
    // browsing never sees test-only markup. Read server-side only (see
    // app/page.tsx), not a NEXT_PUBLIC_* client-bundled var, so there's no
    // build-cache staleness to worry about across dev-server restarts.
    env: { E2E_DEBUG: "1" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
