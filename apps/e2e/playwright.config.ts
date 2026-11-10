import { defineConfig, type PlaywrightTestConfig } from "@playwright/test"

import { DASHBOARD_URL, URLS, WORKOS, backendEnv, portOf } from "./env"

/**
 * The local suite starts every service. With NUNI_RELEASE_VERSION set, only
 * the `release` project runs: the published packages against production.
 */
const local: PlaywrightTestConfig = {
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testMatch: /tests\/.*\.spec\.ts/,
      testIgnore: /tests\/release\//,
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "bun scripts/workos-emulate.ts",
      url: `${URLS.workos}/health`,
      timeout: 60_000,
    },
    {
      command: "bun scripts/setup-convex.ts",
      url: URLS.convexReady,
      timeout: 240_000,
      // Lets the script stop `convex dev` and the backend binary it starts.
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
    {
      command: `bunx vite --host 127.0.0.1 --port ${portOf(URLS.playground)} --strictPort`,
      cwd: "../playground",
      url: URLS.playground,
      env: backendEnv("VITE_"),
    },
    {
      command: `bunx next dev --port ${portOf(URLS.app)}`,
      cwd: "../dashboard",
      url: DASHBOARD_URL,
      timeout: 180_000,
      env: {
        ...backendEnv("NEXT_PUBLIC_"),
        WORKOS_CLIENT_ID: WORKOS.clientId,
        WORKOS_API_KEY: WORKOS.apiKey,
        WORKOS_API_HOSTNAME: new URL(URLS.workos).hostname,
        WORKOS_API_PORT: String(portOf(URLS.workos)),
        WORKOS_API_HTTPS: "false",
        WORKOS_COOKIE_PASSWORD: WORKOS.cookiePassword,
        NEXT_PUBLIC_WORKOS_REDIRECT_URI: `${DASHBOARD_URL}/callback`,
      },
    },
    {
      command: `bunx blume dev --port ${portOf(URLS.docs)}`,
      cwd: "../docs",
      url: URLS.docs,
      timeout: 120_000,
      env: backendEnv("PUBLIC_NUNI_"),
      // Lets blume remove its dev lock, or the next run refuses to start.
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
  ],
}

const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy
const release: PlaywrightTestConfig = {
  projects: [
    {
      name: "release",
      testMatch: /tests\/release\/.*\.spec\.ts/,
      timeout: 180_000,
      use: {
        // Sandboxes that only allow outbound traffic through a proxy.
        proxy: proxy
          ? { server: proxy, bypass: "localhost,127.0.0.1" }
          : undefined,
      },
    },
  ],
}

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  ...(process.env.NUNI_RELEASE_VERSION ? release : local),
  use: {
    baseURL: URLS.playground,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
})
