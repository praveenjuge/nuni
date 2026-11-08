import { urlDefines } from "@nuni/shared/build"
import { defineConfig } from "vitest/config"

export default defineConfig({
  define: {
    ...urlDefines({}),
    __NUNI_VERSION__: JSON.stringify("test"),
  },
  test: { environment: "happy-dom" },
})
