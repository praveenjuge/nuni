export const LIMITS = {
  bodyMaxLength: 2000,
  nameMaxLength: 50,
  unclaimedCommentCap: 500,
  maxOriginsPerProject: 20,
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  anchorTextMaxLength: 120,
  /** Per page, the widget loads this many newest open and resolved comments. */
  pageOpenLimit: 1000,
  pageResolvedLimit: 200,
} as const
