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
  /**
   * Extra context attached to each comment for the project owner and their
   * coding agent. Everything is on by default; set a key to `false` to stop
   * capturing it.
   */
  capture?: {
    /** Recent console errors and warnings. */
    console?: boolean
    /** Recent failed requests (method, origin + path, status). */
    network?: boolean
    /** The element's markup (form values removed) and key styles. */
    dom?: boolean
    /** An image of the element and its surroundings. */
    screenshot?: boolean
  }
}

export interface ResolvedConfig {
  project: string
  convexUrl: string
  convexSiteUrl: string
  appUrl: string
  getPageKey?: (url: URL) => string
  capture: {
    console: boolean
    network: boolean
    dom: boolean
    screenshot: boolean
  }
}

export const VERSION: string = __NUNI_VERSION__

export function resolveConfig(options: NuniOptions): ResolvedConfig {
  return {
    project: options.project,
    convexUrl: options.convexUrl ?? __NUNI_CONVEX_URL__,
    convexSiteUrl: options.convexSiteUrl ?? __NUNI_CONVEX_SITE_URL__,
    appUrl: (options.appUrl ?? __NUNI_APP_URL__).replace(/\/$/, ""),
    getPageKey: options.getPageKey,
    capture: {
      console: options.capture?.console ?? true,
      network: options.capture?.network ?? true,
      dom: options.capture?.dom ?? true,
      screenshot: options.capture?.screenshot ?? true,
    },
  }
}
