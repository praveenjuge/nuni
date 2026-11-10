import { defineConfig } from "vitest/config"

import { define } from "./tsdown.config"

export default defineConfig({
  define,
  test: { environment: "happy-dom" },
})
