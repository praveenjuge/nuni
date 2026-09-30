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
  /**
   * Max UTF-8 bytes of a stored comment's payload (body, author, search
   * text, page, anchor, viewport, user agent). listForPage reads up to
   * pageOpenLimit + pageResolvedLimit documents of one page in a single
   * transaction, and Convex aborts any transaction that reads more than
   * 16 MiB; this bound keeps the full 1200-document window below it.
   */
  commentStoredBytesMax: 13_000,
  /**
   * Bytes of search text stored per comment. Sized to cover a maximal
   * multi-byte body plus author name so search always matches accepted
   * comments end to end; commentStoredBytesMax still bounds the whole
   * document at insert time.
   */
  searchTextBytesMax: 8_192,
} as const
