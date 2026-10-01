declare const __NUNI_CONVEX_URL__: string | undefined
declare const __NUNI_CONVEX_SITE_URL__: string | undefined
declare const __NUNI_APP_URL__: string | undefined

/**
 * Backend URLs, set at build time (see tsdown.config.ts). The env vars
 * override them, for local development and tests.
 */
export const CONVEX_URL =
  process.env.NUNI_CONVEX_URL ??
  (typeof __NUNI_CONVEX_URL__ === "string"
    ? __NUNI_CONVEX_URL__
    : "http://127.0.0.1:3210")

export const CONVEX_SITE_URL =
  process.env.NUNI_CONVEX_SITE_URL ??
  (typeof __NUNI_CONVEX_SITE_URL__ === "string"
    ? __NUNI_CONVEX_SITE_URL__
    : "http://127.0.0.1:3211")

export const APP_URL =
  process.env.NUNI_APP_URL ??
  (typeof __NUNI_APP_URL__ === "string"
    ? __NUNI_APP_URL__
    : "http://localhost:3000")
