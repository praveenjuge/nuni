export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface AnchorAncestor {
  tag: string
  id?: string
  classes: string[]
  text?: string
}

/** Everything needed to find a commented element again. Version 1. */
export interface Anchor {
  v: 1
  selectors: {
    id?: string
    testId?: string
    css?: string
    path: string
  }
  tag: string
  /** Stable, human-authored classes on the element itself. */
  classes?: string[]
  role?: string
  text: string
  attrs: Record<string, string>
  ancestors: AnchorAncestor[]
  siblingIndex: number
  siblingCount: number
  componentName?: string
  /** Element box in document coordinates at capture time. */
  rect: Rect
  /** Click point inside the element, 0..1 on each axis. */
  offset: { x: number; y: number }
  viewport: {
    w: number
    h: number
    dpr: number
    scrollX: number
    scrollY: number
  }
  docSize: { w: number; h: number }
  /**
   * Shadow hosts and same-origin iframes on the way to the element,
   * outermost first. The selectors above are relative to the innermost one.
   */
  scope?: AnchorScope[]
}

/** One shadow host or <iframe>, captured like any element in its own scope. */
export interface AnchorScope {
  kind: "shadow" | "frame"
  host: Omit<Anchor, "scope">
}

export type CommentStatus = "open" | "resolved"

export interface ConsoleEntry {
  level: "error" | "warn"
  message: string
  at: number
}

/** A failed request. `url` is origin + path only; `status` 0 is a network error. */
export interface NetworkEntry {
  method: string
  url: string
  status: number
  at: number
}

export interface DomContext {
  /** Trimmed outerHTML, with form values removed. */
  html: string
  /** A fixed set of computed styles. */
  styles: Record<string, string>
}

/**
 * Extra context captured with a comment. Only the project owner can read it,
 * since comments themselves are readable by anyone with the project ID.
 */
export interface CommentContext {
  console?: ConsoleEntry[]
  network?: NetworkEntry[]
  dom?: DomContext
}

/** Shape of a comment as the widget receives it. */
export interface WidgetComment {
  _id: string
  _creationTime: number
  status: CommentStatus
  body: string
  authorName: string
  authorKeyHash: string
  /** Public listings only include origin, path and title. */
  page: {
    origin: string
    path: string
    title: string
    search?: string
    hash?: string
    url?: string
  }
  anchor: Anchor
  viewport: { w: number; h: number; dpr: number }
  createdAt: number
  editedAt?: number
  resolvedAt?: number
  /** Replies in the thread (not counting the comment itself). */
  replyCount?: number
}

/** A reply in a comment's thread. */
export interface ReplyView {
  _id: string
  commentId: string
  body: string
  authorName: string
  authorKeyHash: string
  /** Written by the project owner (widget session, dashboard or CLI). */
  isOwner: boolean
  createdAt: number
  editedAt?: number
}

/** One emoji on a comment or reply, with who added it. */
export interface ReactionSummary {
  /** The comment or reply id. */
  targetId: string
  emoji: string
  count: number
  authorKeyHashes: string[]
}

export interface Thread {
  replies: ReplyView[]
  reactions: ReactionSummary[]
}

/** A comment as the owner sees it (dashboard, owner widget, agents). */
export interface OwnerComment extends WidgetComment {
  userAgent?: string
  context?: CommentContext
  screenshotUrl?: string | null
  replies?: ReplyView[]
}
