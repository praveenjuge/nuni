import { readFileSync } from "node:fs"

import { createEmulator } from "@workos/emulate"
import { parse } from "yaml"

import { EMULATOR_SEED, URLS, WORKOS, portOf } from "../env"

const emulator = await createEmulator({
  port: portOf(URLS.workos),
  seed: {
    ...parse(readFileSync(EMULATOR_SEED, "utf8")),
    webhookEndpoints: [
      {
        endpoint_url: `${URLS.convexSite}/workos/webhook`,
        secret: WORKOS.webhookSecret,
        events: ["user.created", "user.updated", "user.deleted"],
      },
    ],
  },
  signingKey: {
    privateKey: readFileSync(
      new URL("./workos-test-key.pem", import.meta.url),
      "utf8"
    ),
  },
  interactiveAuth: { password: true },
})
console.log(`WorkOS Emulate on ${emulator.url}`)
