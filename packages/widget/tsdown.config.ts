import { readFileSync } from "node:fs"

import { urlDefines } from "@nuni/shared/build"
import { defineConfig } from "tsdown"

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as {
  version: string
}

const define = {
  ...urlDefines(process.env),
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
  {
    // Loaded by nuni.global.js on demand (see src/global.ts).
    entry: { "nuni-screenshot": "src/screenshot.global.ts" },
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
