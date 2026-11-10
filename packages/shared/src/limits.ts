/**
 * Limits more than one package has to agree on: the client checks or shows
 * them and the backend enforces them, or the docs and dashboard state them.
 * Limits only the backend knows about live in `packages/backend/convex/limits.ts`.
 */
export const LIMITS = {
  bodyMaxLength: 2000,
  nameMaxLength: 50,
  projectNameMaxLength: 100,
  unclaimedCommentCap: 500,
  /** Widget owner sessions and commenter sign-ins. */
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  /** CLI and MCP sessions, created by `nuni login`. */
  cliSessionTtlMs: 90 * 24 * 60 * 60 * 1000,
  /** How long a project transfer link works. */
  transferTtlMs: 7 * 24 * 60 * 60 * 1000,
  /** Comments changed at once from the dashboard. */
  bulkMax: 100,
  /** Pins found or lost in one report from a visitor's widget. */
  pinReportMax: 200,
  /** The dashboard's "Not found" count stops here ("99+"). */
  lostCountMax: 99,
  /** Comments an agent (CLI or MCP) lists at once: by default, and at most. */
  agentListDefault: 20,
  agentListMax: 50,
  /** The text kept for the commented element, and for its ancestors. */
  anchorTextMaxLength: 120,
  anchorAncestorTextMaxLength: 80,
  /** Ancestors kept for the commented element, closest first. */
  anchorAncestorsMax: 5,
  /** Shadow roots and iframes the element can be nested in. */
  anchorScopeMaxDepth: 8,
  /** Selected text kept with a text comment, and the context around it. */
  quoteMaxLength: 500,
  quoteContextLength: 32,
  /** Most console or network entries kept with one comment. */
  contextEntryMax: 20,
  contextMessageMaxLength: 500,
  /** Trimmed outerHTML of the commented element. */
  domSnippetMaxLength: 4000,
  screenshotMaxBytes: 600_000,
  /** Images a commenter attaches to one comment (their own or marked up). */
  imagesPerComment: 3,
  imageMaxBytes: 600_000,
} as const

/** The reactions anyone can add to a comment or reply. */
export const REACTIONS = ["👍", "❤️", "🎉", "👀", "✅", "😄"] as const
