import {
  DASHBOARD_PATH,
  DASHBOARD_ROUTES,
  dashboardPath,
  dashboardUrl,
} from "@nuni/shared"
import { DEV_URLS } from "@nuni/shared/build"

import type nextConfig from "../next.config"

/** The basePath: a type error here means next.config.ts disagrees. */
export const BASE_PATH: (typeof nextConfig)["basePath"] = DASHBOARD_PATH

/**
 * Public origin the dashboard is served from: https://nuni.praveenjuge.com in
 * production (the dashboard sits behind the docs site's /dashboard rewrite),
 * http://localhost:3000 locally.
 */
export const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? DEV_URLS.app
).replace(/\/+$/, "")

export const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? DEV_URLS.convex

/**
 * A dashboard URL on the public origin, for links that leave the app: sign-in
 * redirects, AuthKit callbacks and links people send to others. Pages link
 * to each other with `<Link href={route}>`, which adds the basePath itself.
 */
export function appUrl(route = "", query?: Record<string, string>): string {
  return dashboardUrl(APP_URL, route, query)
}

export const REDIRECT_URI =
  process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ?? appUrl("/callback")

/** Only allow redirects back into the dashboard. */
export function safeReturnTo(value: string | null): string {
  return value?.startsWith(BASE_PATH) ? value : BASE_PATH
}

/** Sign in first, then come back to `route` in the dashboard. */
export function signInUrl(
  route: string,
  query?: Record<string, string>
): string {
  return appUrl(DASHBOARD_ROUTES.signIn, {
    returnTo: dashboardPath(route, query),
  })
}
