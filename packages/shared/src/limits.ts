export const LIMITS = {
  bodyMaxLength: 2000,
  nameMaxLength: 50,
  unclaimedCommentCap: 500,
  maxOriginsPerProject: 20,
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  /** CLI and MCP sessions, created by `nuni login`. */
  cliSessionTtlMs: 90 * 24 * 60 * 60 * 1000,
  /** How long a `nuni login` code waits for approval in the dashboard. */
  cliLoginTtlMs: 10 * 60 * 1000,
  anchorTextMaxLength: 120,
  /** Per page, the widget loads this many newest open and resolved comments. */
  pageOpenLimit: 1000,
  pageResolvedLimit: 200,
  /** Most console or network entries kept with one comment. */
  contextEntryMax: 20,
  contextMessageMaxLength: 500,
  /** Trimmed outerHTML of the commented element. */
  domSnippetMaxLength: 4000,
  screenshotMaxBytes: 600_000,
  /** How long after posting the author can still attach the screenshot. */
  screenshotUploadWindowMs: 5 * 60 * 1000,
} as const
