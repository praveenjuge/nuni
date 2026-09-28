import { defineConfig } from "tsdown"

export default defineConfig({
  entry: { index: "src/index.tsx" },
  format: "esm",
  platform: "browser",
  target: "es2020",
  dts: true,
  deps: { neverBundle: ["react", "@nuni/widget"] },
  clean: true,
})
