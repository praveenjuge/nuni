import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { DASHBOARD_PATH } from "@nuni/shared"
import { parse } from "yaml"

/**
 * Every service the suite starts. Convex runs on 3310/3311, not its default
 * 3210/3211, so a developer's own `convex dev` can keep running.
 */
export const URLS = {
  playground: "http://127.0.0.1:5173",
  convex: "http://127.0.0.1:3310",
  convexSite: "http://127.0.0.1:3311",
  /** Answers once the isolated Convex backend has the functions pushed. */
  convexReady: "http://127.0.0.1:4199",
  app: "http://localhost:3000",
  docs: "http://localhost:4321",
  workos: "http://localhost:4100",
} as const

export const DASHBOARD_URL = `${URLS.app}${DASHBOARD_PATH}`

export function portOf(url: string): number {
  return Number(new URL(url).port)
}

/**
 * The backend URLs under the names each app reads them by (`VITE_`,
 * `NEXT_PUBLIC_`, `PUBLIC_NUNI_`, `NUNI_`).
 */
export function backendEnv(prefix: string): Record<string, string> {
  return {
    [`${prefix}CONVEX_URL`]: URLS.convex,
    [`${prefix}CONVEX_SITE_URL`]: URLS.convexSite,
    [`${prefix}APP_URL`]: URLS.app,
  }
}

/** The local WorkOS app the dashboard and backend talk to. */
export const WORKOS = {
  clientId: "client_nuni_local",
  /** The key WorkOS Emulate accepts by default. */
  apiKey: "sk_test_default",
  webhookSecret: "whsec_nuni_local",
  cookiePassword: "nuni-local-cookie-password-at-least-32-characters",
}

/** The isolated Convex project `scripts/setup-convex.ts` creates each run. */
export const BACKEND_DIR = fileURLToPath(
  new URL("./.runtime/backend", import.meta.url)
)

/** Signed-in browser state saved by `auth.setup.ts`. */
export const AUTH_STATE = {
  owner: fileURLToPath(new URL("./.auth/owner.json", import.meta.url)),
  secondOwner: fileURLToPath(
    new URL("./.auth/second-owner.json", import.meta.url)
  ),
}

export const EMULATOR_SEED = fileURLToPath(
  new URL("./workos-emulate.config.yaml", import.meta.url)
)

interface SeedUser {
  id: string
  email: string
  first_name: string
  last_name: string
  password: string
}

const seed = parse(readFileSync(EMULATOR_SEED, "utf8")) as {
  users: SeedUser[]
}

function seededUser(id: string) {
  const user = seed.users.find((u) => u.id === id)
  if (!user) throw new Error(`${EMULATOR_SEED} has no user ${id}`)
  return {
    email: user.email,
    password: user.password,
    name: `${user.first_name} ${user.last_name}`,
  }
}

export const USERS = {
  owner: seededUser("user_nuni_owner"),
  secondOwner: seededUser("user_nuni_second_owner"),
  commenter: seededUser("user_nuni_commenter"),
}
