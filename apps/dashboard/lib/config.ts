import { DASHBOARD_PATH, DASHBOARD_ROUTES, dashboardUrl } from "@nuni/shared"

import type nextConfig from "../next.config"

/** The basePath: a type error here means next.config.ts disagrees. */
export const BASE_PATH: (typeof nextConfig)["basePath"] = DASHBOARD_PATH

/**
 * Public origin the dashboard is served from: https://nuni.praveenjuge.com in
 * production (the dashboard sits behind the docs site's /dashboard rewrite),
 * http://localhost:3000 locally.
 */
export const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
).replace(/\/$/, "")

export const REDIRECT_URI =
  process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ??
  `${APP_URL}${BASE_PATH}/callback`

/** Only allow redirects back into the dashboard. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith(`${BASE_PATH}`) || value.startsWith("//"))
    return BASE_PATH
  return value
}

/** Sign in first, then come back to `returnTo` (a path in the dashboard). */
export function signInUrl(returnTo: string): string {
  return dashboardUrl(APP_URL, DASHBOARD_ROUTES.signIn, { returnTo })
}
