import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    env: {
      WORKOS_CLIENT_ID: "client_test",
      WORKOS_API_KEY: "sk_test",
      WORKOS_WEBHOOK_SECRET: "whsec_test",
    },
  },
})
