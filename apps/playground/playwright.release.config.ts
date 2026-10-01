import { defineConfig } from "@playwright/test"

/**
 * Smoke test for a published release: the npm and CDN packages against the
 * production backend. Run after a release, not in CI:
 *
 *   NUNI_RELEASE_VERSION=0.1.4 bun run --cwd apps/playground smoke:release
 */
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy

export default defineConfig({
  testDir: "release",
  timeout: 180_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    headless: true,
    // Sandboxes that only allow outbound traffic through a proxy.
    proxy: proxy ? { server: proxy, bypass: "localhost,127.0.0.1" } : undefined,
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
})
