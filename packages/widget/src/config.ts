import { normalizePath } from "@nuni/shared"

import type { Messages } from "./i18n"

export type Position =
  | "bottom-right"
  | "bottom-center"
  | "bottom-left"
  | "top-right"
  | "top-center"
  | "top-left"
export type Theme = "auto" | "light" | "dark"
/** Built-in page keys, for when `getPageKey` is not set. */
export type PageKey = "path" | "path+search" | "path+hash"

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
   * Which part of the URL tells pages apart, when `getPageKey` is not set:
   * the path (default), the path and query string, or the path and hash.
   */
  pageKey?: PageKey
  /**
   * Where the toolbar starts. Default "bottom-right". Visitors can drag it to
   * another corner or edge middle, and their choice is remembered.
   */
  position?: Position
  /** Brand color for buttons, pins and highlights (any CSS color). */
  accentColor?: string
  /** "auto" follows the visitor's system (default). */
  theme?: Theme
  /** Text on the toolbar's comment button. Default "Comment". */
  label?: string
  /** Key that starts a comment. Default "c"; `false` turns it off. */
  hotkey?: string | false
  /** Stacking order of the widget. Default 2147483646. */
  zIndex?: number
  /** Language for dates and counts, e.g. "de". Defaults to the browser's. */
  locale?: string
  /** Replace any of the widget's words. See the `EN` messages. */
  messages?: Partial<Messages>
  /**
   * Let commenters attach images and mark up the screenshot. They are shown
   * to everyone who can see the comment. Default true; claimed sites only.
   */
  images?: boolean
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
  getPageKey: (url: URL) => string
  position: Position
  accentColor: string | null
  theme: Theme
  label: string | null
  hotkey: string | null
  zIndex: number | null
  locale: string | undefined
  messages: Partial<Messages>
  images: boolean
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
    getPageKey: options.getPageKey ?? pageKeyFor(options.pageKey),
    position: oneOf(options.position, POSITIONS, "bottom-right"),
    accentColor: options.accentColor?.trim() || null,
    theme: oneOf(options.theme, THEMES, "auto"),
    label: options.label?.trim() || null,
    hotkey:
      options.hotkey === false
        ? null
        : options.hotkey?.trim().slice(0, 1).toLowerCase() || "c",
    zIndex:
      typeof options.zIndex === "number" && Number.isFinite(options.zIndex)
        ? Math.round(options.zIndex)
        : null,
    locale: options.locale?.trim() || undefined,
    messages: options.messages ?? {},
    images: options.images ?? true,
    capture: {
      console: options.capture?.console ?? true,
      network: options.capture?.network ?? true,
      dom: options.capture?.dom ?? true,
      screenshot: options.capture?.screenshot ?? true,
    },
  }
}

export const POSITIONS: readonly Position[] = [
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "top-right",
  "top-center",
  "top-left",
]
const THEMES: readonly Theme[] = ["auto", "light", "dark"]

export function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** Query parameters that never tell pages apart. */
const IGNORED_PARAMS = /^(nuni|utm_.*|fbclid|gclid|msclkid|ref)$/i

export function pageKeyFor(preset: PageKey = "path"): (url: URL) => string {
  return (url) => {
    const path = normalizePath(url)
    if (preset === "path+search") {
      const params = [...url.searchParams]
        .filter(([name]) => !IGNORED_PARAMS.test(name))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      return params.length
        ? `${path}?${new URLSearchParams(params).toString()}`
        : path
    }
    // A hash route (#/settings) is already part of the path.
    if (preset === "path+hash" && url.hash.length > 1 && !path.includes("#")) {
      if (!/^#!?\//.test(url.hash)) return `${path}${url.hash}`
    }
    return path
  }
}
