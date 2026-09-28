import { readFileSync } from "node:fs"

import { defineConfig } from "tsdown"

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as {
  version: string
}

const release = process.env.NUNI_RELEASE === "1"
function env(name: string, fallback: string): string {
  const value = process.env[name]
  if (value) return value
  if (release) throw new Error(`${name} must be set for a release build`)
  return fallback
}

const define = {
  __NUNI_CONVEX_URL__: JSON.stringify(
    env("NUNI_CONVEX_URL", "http://127.0.0.1:3210")
  ),
  __NUNI_CONVEX_SITE_URL__: JSON.stringify(
    env("NUNI_CONVEX_SITE_URL", "http://127.0.0.1:3211")
  ),
  __NUNI_APP_URL__: JSON.stringify(
    env("NUNI_APP_URL", "http://localhost:3000")
  ),
  __NUNI_VERSION__: JSON.stringify(pkg.version),
}

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: "esm",
    platform: "browser",
    target: "es2020",
    dts: true,
    define,
    deps: { alwaysBundle: [/^@nuni\//, /^convex/], onlyBundle: false },
    clean: true,
  },
  {
    entry: { nuni: "src/global.ts" },
    format: "iife",
    platform: "browser",
    target: "es2020",
    dts: false,
    minify: true,
    define,
    deps: { alwaysBundle: [/.*/], onlyBundle: false },
    outputOptions: { entryFileNames: "[name].global.js" },
  },
])
