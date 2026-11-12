/**
 * Limits only the backend knows about: how much it keeps, lists and reads.
 * Limits clients or the docs must agree on are `LIMITS` in `@nuni/shared`.
 */
export const SERVER_LIMITS = {
  /** Origins an unclaimed project collects, or an owner adds. */
  maxOriginsPerProject: 20,
  /** How long a `nuni login` code waits for approval in the dashboard. */
  cliLoginTtlMs: 10 * 60 * 1000,
  /** How long after posting the author can still attach a file. */
  uploadWindowMs: 5 * 60 * 1000,

  /** Per page, the widget loads this many newest open and resolved comments. */
  pageOpenLimit: 1000,
  pageResolvedLimit: 200,
  /** The widget's panel lists this many newest comments from every page. */
  siteOpenLimit: 300,
  siteResolvedLimit: 100,
  /** The newest of a commenter's own comments, across pages. */
  yoursLimit: 100,
  /** Pages with open comments listed for the widget and agents. */
  pagesListMax: 200,
  /** Pages offered as dashboard filters. */
  pageFiltersMax: 1000,
  /** Projects listed for one owner. */
  projectsListMax: 200,
  /** Replies kept per comment thread. */
  repliesPerComment: 200,
  /** Reactions kept per thread (the comment and its replies). */
  reactionsPerComment: 2000,

  /** Stored page details; `path` is also the key comments are listed by. */
  pageTitleMaxLength: 300,
  pageUrlMaxLength: 2000,
  pagePartMaxLength: 1000,
  userAgentMaxLength: 400,
  /** Captured request methods, and the styles kept for the element. */
  methodMaxLength: 10,
  stylesMax: 30,
  styleNameMaxLength: 40,
  styleValueMaxLength: 200,
  /** The CLI's description of itself, shown when approving a login. */
  cliClientMaxLength: 200,

  /** Longer tokens are never ours, so they aren't even hashed. */
  tokenMaxLength: 200,
  /** The browser secret the widget makes (`generateSecret`, 32 characters). */
  authorSecretMinLength: 16,
  authorSecretMaxLength: 128,

  /**
   * JSON bodies of the HTTP routes, in bytes: room for 64,000, 16,000 and
   * 2,000 characters even when each takes 3 bytes in UTF-8.
   */
  commentBodyMax: 192_000,
  replyBodyMax: 48_000,
  pinReportBodyMax: 48_000,
  cliLoginBodyMax: 6_000,

  /**
   * Activity read for one email. Each record can mean reading a whole
   * comment (tens of kilobytes with its page context), so this keeps one
   * email well inside a transaction's read limit. Anything beyond goes out
   * in another email an hour later.
   */
  emailActivityMax: 200,
  /** Comments shown in one email, and replies shown under each. */
  emailThreadsMax: 25,
  emailRepliesMax: 5,
  /** Comment and reply text shown in an email before it is cut off. */
  emailBodyMaxLength: 600,
  /** Projects whose emails one run of the hourly cron starts. */
  emailProjectsBatch: 50,
  /** How long the unsubscribe link in an email works. */
  unsubscribeTtlMs: 90 * 24 * 60 * 60 * 1000,
  /** Waits before sending an email again after a failure that may pass. */
  emailRetryDelaysMs: [30_000, 5 * 60_000],

  /** Guest comments, replies and reactions moved to an account at sign-in. */
  linkBrowserMax: 200,
  /** Rows a daily cleanup or a project delete handles per transaction. */
  cleanupBatch: 500,
  deleteBatch: 100,
} as const
