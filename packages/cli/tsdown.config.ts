import { defineConfig } from "tsdown"

const release = process.env.NUNI_RELEASE === "1"
function env(name: string, fallback: string): string {
  const value = process.env[name]
  if (value) return value
  if (release) throw new Error(`${name} must be set for a release build`)
  return fallback
}

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  platform: "node",
  target: "node18",
  dts: false,
  clean: true,
  define: {
    __NUNI_CONVEX_URL__: JSON.stringify(
      env("NUNI_CONVEX_URL", "http://127.0.0.1:3210")
    ),
    __NUNI_CONVEX_SITE_URL__: JSON.stringify(
      env("NUNI_CONVEX_SITE_URL", "http://127.0.0.1:3211")
    ),
    __NUNI_APP_URL__: JSON.stringify(
      env("NUNI_APP_URL", "http://localhost:3000")
    ),
  },
  // The published CLI has no runtime dependencies.
  deps: { alwaysBundle: [/^@nuni\//, /^convex/], onlyBundle: false },
  outputOptions: { banner: "#!/usr/bin/env node" },
})
