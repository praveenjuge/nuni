import { defineConfig } from "@playwright/test"
export default defineConfig({
  testDir: ".",
  testMatch: /tests\/.*\.spec\.ts|auth\.setup\.ts/,
  timeout: 60_000,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command:
        "bunx workos-emulate --interactive --interactive-password --seed workos-emulate.config.yaml --signing-key scripts/workos-test-key.pem",
      url: "http://localhost:4100/health",
      timeout: 60_000,
    },
    {
      command: "bun scripts/setup-convex.ts",
      url: "http://127.0.0.1:4199/ready",
      timeout: 240_000,
    },
    {
      command: "bun run --cwd ../playground dev -- --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      env: {
        VITE_CONVEX_URL: "http://127.0.0.1:3310",
        VITE_CONVEX_SITE_URL: "http://127.0.0.1:3311",
        VITE_APP_URL: "http://localhost:3000",
      },
    },
    {
      command: "bun run --cwd ../dashboard dev",
      url: "http://localhost:3000/dashboard",
      timeout: 180_000,
      env: {
        WORKOS_CLIENT_ID: "client_nuni_local",
        WORKOS_API_KEY: "sk_test_default",
        WORKOS_API_HOSTNAME: "localhost",
        WORKOS_API_PORT: "4100",
        WORKOS_API_HTTPS: "false",
        WORKOS_COOKIE_PASSWORD:
          "nuni-local-cookie-password-at-least-32-characters",
        NEXT_PUBLIC_WORKOS_REDIRECT_URI:
          "http://localhost:3000/dashboard/callback",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3310",
      },
    },
    {
      command: "bun run --cwd ../docs dev",
      url: "http://localhost:4321",
      timeout: 120_000,
      env: {
        PUBLIC_NUNI_CONVEX_URL: "http://127.0.0.1:3310",
        PUBLIC_NUNI_CONVEX_SITE_URL: "http://127.0.0.1:3311",
        PUBLIC_NUNI_APP_URL: "http://localhost:3000",
      },
    },
  ],
})
