export const LIMITS = {
  bodyMaxLength: 2000,
  nameMaxLength: 50,
  unclaimedCommentCap: 500,
  maxOriginsPerProject: 20,
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
  /** How long a `nuni login` code waits for approval in the dashboard. */
  cliLoginTtlMs: 10 * 60 * 1000,
  anchorTextMaxLength: 120,
  /** Selected text kept with a text comment, and the context around it. */
  quoteMaxLength: 500,
  quoteContextLength: 32,
  /** Per page, the widget loads this many newest open and resolved comments. */
  pageOpenLimit: 1000,
  pageResolvedLimit: 200,
  /** The newest of a commenter's own comments, across pages. */
  yoursLimit: 100,
  /** Most console or network entries kept with one comment. */
  contextEntryMax: 20,
  contextMessageMaxLength: 500,
  /** Trimmed outerHTML of the commented element. */
  domSnippetMaxLength: 4000,
  screenshotMaxBytes: 600_000,
  /** Replies kept per comment thread. */
  repliesPerComment: 200,
  /** Reactions kept per thread (the comment and its replies). */
  reactionsPerComment: 2000,
  /** How long after posting the author can still attach the screenshot. */
  screenshotUploadWindowMs: 5 * 60 * 1000,
} as const

/** The reactions anyone can add to a comment or reply. */
export const REACTIONS = ["👍", "❤️", "🎉", "👀", "✅", "😄"] as const

export type Reaction = (typeof REACTIONS)[number]
