import packageJson from "../package.json"

import { DEV_URLS } from "@nuni/shared/build"

declare const __NUNI_CONVEX_URL__: string | undefined
declare const __NUNI_CONVEX_SITE_URL__: string | undefined
declare const __NUNI_APP_URL__: string | undefined

export const VERSION = packageJson.version

/**
 * Backend URLs, set at build time (see tsdown.config.ts); running from
 * source has none. The env vars override them, for local development and
 * tests.
 */
export const CONVEX_URL =
  process.env.NUNI_CONVEX_URL ??
  (typeof __NUNI_CONVEX_URL__ === "string"
    ? __NUNI_CONVEX_URL__
    : DEV_URLS.convex)

export const CONVEX_SITE_URL =
  process.env.NUNI_CONVEX_SITE_URL ??
  (typeof __NUNI_CONVEX_SITE_URL__ === "string"
    ? __NUNI_CONVEX_SITE_URL__
    : DEV_URLS.convexSite)

export const APP_URL =
  process.env.NUNI_APP_URL ??
  (typeof __NUNI_APP_URL__ === "string" ? __NUNI_APP_URL__ : DEV_URLS.app)
