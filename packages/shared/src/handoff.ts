/**
 * The contract between the dashboard and the packages that send people to
 * it: the widget (claim and sign-in popups), the CLI (`nuni login`) and
 * transfer links. Published widgets and CLIs open these routes and check
 * these messages, so the paths, query names, message types and token
 * prefixes must never change.
 */

/** Where the dashboard is served on the app origin (its Next.js basePath). */
export const DASHBOARD_PATH = "/dashboard"

/** Dashboard pages, relative to `DASHBOARD_PATH`. */
export const DASHBOARD_ROUTES = {
  /** `?project=&origin=`: claim a site and allow owner tools on it. */
  claim: "/claim",
  /** `?project=&origin=`: sign in to comment under an account. */
  commentSignIn: "/comment-sign-in",
  /** `?code=`: approve a `nuni login`. */
  cli: "/cli",
  /** `?token=`: accept a project someone hands over. */
  transfer: "/transfer",
  /** `?token=`: turn off a project's emails, from a link in one. */
  unsubscribe: "/unsubscribe",
  /** `?returnTo=`: a path inside the dashboard. */
  signIn: "/sign-in",
  signOut: "/sign-out",
} as const

/** A project's page, relative to `DASHBOARD_PATH`. */
export function projectRoute(publicId: string): string {
  return `/p/${publicId}`
}

/** A dashboard path with its basePath, and the query, if any. */
export function dashboardPath(
  route: string,
  query: Record<string, string> = {}
): string {
  const search = new URLSearchParams(query).toString()
  return `${DASHBOARD_PATH}${route}${search ? `?${search}` : ""}`
}

/** A dashboard URL on the app origin (a trailing slash on `appUrl` is fine). */
export function dashboardUrl(
  appUrl: string,
  route: string,
  query?: Record<string, string>
): string {
  return appUrl.replace(/\/+$/, "") + dashboardPath(route, query)
}

/**
 * Prefixes of the tokens Nuni hands out. The widget only accepts a
 * handed-over token with the right prefix.
 */
export const TOKEN_PREFIX = {
  /** Owner sessions: the widget's owner tools, and the CLI. */
  session: "nuni_s_",
  commenter: "nuni_c_",
  transfer: "nuni_t_",
  /** The secret a `nuni login` polls with. */
  device: "nuni_d_",
  /** The link in an email that turns the project's emails off. */
  unsubscribe: "nuni_u_",
} as const

/**
 * What the dashboard popup posts back to the widget that opened it: an
 * owner session after a claim, or a commenter sign-in.
 */
const HANDOFF_TYPE = {
  session: "nuni:session",
  commenter: "nuni:commenter",
} as const

type HandoffKind = keyof typeof HANDOFF_TYPE

export interface HandoffMessage {
  type: (typeof HANDOFF_TYPE)[HandoffKind]
  project: string
  token: string
}

export function handoffMessage(
  kind: HandoffKind,
  project: string,
  token: string
): HandoffMessage {
  return { type: HANDOFF_TYPE[kind], project, token }
}

/** The token a message hands to this project's widget, or null. */
export function readHandoff(
  data: unknown,
  project: string
): { kind: HandoffKind; token: string } | null {
  if (!data || typeof data !== "object") return null
  const message = data as Partial<Record<keyof HandoffMessage, unknown>>
  if (message.project !== project || typeof message.token !== "string") {
    return null
  }
  for (const kind of ["commenter", "session"] as const) {
    if (
      message.type === HANDOFF_TYPE[kind] &&
      message.token.startsWith(TOKEN_PREFIX[kind])
    ) {
      return { kind, token: message.token }
    }
  }
  return null
}
