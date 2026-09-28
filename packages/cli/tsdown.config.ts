import { defineConfig } from "tsdown"

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  platform: "node",
  target: "node18",
  dts: false,
  clean: true,
  deps: { alwaysBundle: [/^@nuni\//], onlyBundle: false },
  outputOptions: { banner: "#!/usr/bin/env node" },
})
