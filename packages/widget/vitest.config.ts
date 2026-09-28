import { defineConfig } from "vitest/config"

export default defineConfig({
  define: {
    __NUNI_CONVEX_URL__: JSON.stringify("http://127.0.0.1:3210"),
    __NUNI_CONVEX_SITE_URL__: JSON.stringify("http://127.0.0.1:3211"),
    __NUNI_APP_URL__: JSON.stringify("http://localhost:3000"),
    __NUNI_VERSION__: JSON.stringify("test"),
  },
  test: { environment: "happy-dom" },
})
