import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
  webServer: [
    {
      command: "bun run --cwd ../../packages/backend dev:local",
      url: "http://127.0.0.1:3210/version",
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: "bunx vite --port 5173 --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        VITE_CONVEX_URL: "http://127.0.0.1:3210",
        VITE_CONVEX_SITE_URL: "http://127.0.0.1:3211",
        VITE_APP_URL: "http://localhost:3000",
      },
    },
    {
      // Only used as the popup origin for the claim handoff test.
      command: "bun run --cwd ../dashboard dev",
      url: "http://localhost:3000/dashboard/claim",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        WORKOS_CLIENT_ID: "client_e2e_placeholder",
        WORKOS_API_KEY: "placeholder-api-key",
        WORKOS_COOKIE_PASSWORD:
          "e2e-cookie-password-at-least-32-characters-long",
        NEXT_PUBLIC_WORKOS_REDIRECT_URI:
          "http://localhost:3000/dashboard/callback",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210",
      },
    },
  ],
})
