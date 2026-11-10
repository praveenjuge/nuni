import { readFileSync } from "node:fs"

import { urlDefines } from "@nuni/shared/build"
import { defineConfig, type UserConfig } from "tsdown"

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as {
  version: string
}

/** Every `__NUNI_*__` constant (declared in src/env.d.ts), also for tests. */
export const define = {
  ...urlDefines(process.env),
  __NUNI_VERSION__: JSON.stringify(pkg.version),
}

const CSS_START = "/* css */ `"

/** Whitespace and comments out of CSS text, keeping it valid. */
function compactCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/ ?([{};,>]) ?/g, "$1")
    .replace(/: /g, ":")
}

/**
 * The styles are CSS in template literals marked `/* css *\/`; bundlers
 * keep their text as written, so compact it here (the `${…}` parts stay).
 */
function compactCssTemplates() {
  return {
    name: "nuni:compact-css",
    transform(code: string, id: string) {
      if (!id.endsWith(".ts") || !code.includes(CSS_START)) return null
      let out = ""
      let at = 0
      for (;;) {
        const start = code.indexOf(CSS_START, at)
        if (start < 0) break
        out += code.slice(at, start + CSS_START.length)
        let i = start + CSS_START.length
        let text = ""
        while (code[i] !== "`") {
          if (code[i] === "$" && code[i + 1] === "{") {
            out += compactCss(text)
            text = ""
            const end = code.indexOf("}", i)
            out += code.slice(i, end + 1)
            i = end + 1
          } else {
            text += code[i]
            i++
          }
        }
        out += compactCss(text) + "`"
        at = i + 1
      }
      return { code: out + code.slice(at), map: null }
    },
  }
}

const browser = {
  platform: "browser",
  target: "es2020",
  define,
  plugins: [compactCssTemplates()],
} satisfies UserConfig

/** One self-contained script for the CDN, named `<entry>.global.js`. */
const script = (entry: Record<string, string>): UserConfig => ({
  ...browser,
  entry,
  format: "iife",
  dts: false,
  minify: true,
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
  outputOptions: { entryFileNames: "[name].global.js" },
})

export default defineConfig([
  {
    ...browser,
    entry: { index: "src/index.ts" },
    format: "esm",
    dts: true,
    deps: { alwaysBundle: [/^@nuni\//, /^convex/], onlyBundle: false },
    clean: true,
  },
  script({ nuni: "src/global.ts" }),
  // Loaded by nuni.global.js on demand (see src/global.ts).
  script({ "nuni-screenshot": "src/screenshot.global.ts" }),
])
