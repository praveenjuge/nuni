export interface NuniOptions {
  /** Public project ID, e.g. "nuni_4Hk9...". Safe to commit. */
  project: string
  /** Override the Convex deployment (self-hosting and local development). */
  convexUrl?: string
  /** Override the Convex HTTP actions URL (`*.convex.site`). */
  convexSiteUrl?: string
  /** Override the dashboard URL used for claiming and owner sign-in. */
  appUrl?: string
  /** Custom page key. Comments are matched by this; defaults to the normalized path. */
  getPageKey?: (url: URL) => string
}

export interface ResolvedConfig {
  project: string
  convexUrl: string
  convexSiteUrl: string
  appUrl: string
  getPageKey?: (url: URL) => string
}

export const VERSION = __NUNI_VERSION__

export function resolveConfig(options: NuniOptions): ResolvedConfig {
  return {
    project: options.project,
    convexUrl: options.convexUrl ?? __NUNI_CONVEX_URL__,
    convexSiteUrl: options.convexSiteUrl ?? __NUNI_CONVEX_SITE_URL__,
    appUrl: (options.appUrl ?? __NUNI_APP_URL__).replace(/\/$/, ""),
    getPageKey: options.getPageKey,
  }
}
