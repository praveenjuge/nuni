import { urlDefines } from "@nuni/shared/build"
import { defineConfig } from "tsdown"

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  platform: "node",
  target: "node18",
  dts: false,
  clean: true,
  define: urlDefines(process.env),
  // The published CLI has no runtime dependencies.
  deps: { alwaysBundle: [/^@nuni\//, /^convex/], onlyBundle: false },
  outputOptions: { banner: "#!/usr/bin/env node" },
})
