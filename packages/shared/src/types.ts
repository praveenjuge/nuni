import type { Infer, ObjectType } from "convex/values"

import type {
  anchorValidator,
  contextValidator,
  pageValidator,
  resolutionValidator,
  emailFrequencyValidator,
  statusValidator,
  suggestionValidator,
  viewportValidator,
  widgetAuthorArgs,
} from "./validators"

export type Anchor = Infer<typeof anchorValidator>
export type AnchorAncestor = Anchor["ancestors"][number]
export type AnchorQuote = NonNullable<Anchor["quote"]>
export type Rect = Anchor["rect"]

export type CommentStatus = Infer<typeof statusValidator>
export type Resolution = Infer<typeof resolutionValidator>
export type EmailFrequency = Infer<typeof emailFrequencyValidator>
export type CommentContext = Infer<typeof contextValidator>
export type ConsoleEntry = NonNullable<CommentContext["console"]>[number]
export type NetworkEntry = NonNullable<CommentContext["network"]>[number]
export type DomContext = NonNullable<CommentContext["dom"]>
export type TextSuggestion = Infer<typeof suggestionValidator>
export type PageInfo = Infer<typeof pageValidator>
export type Viewport = Infer<typeof viewportValidator>

/**
 * Who is writing: this browser's key, and the commenter's sign-in when they
 * signed in. The browser key is sent either way.
 */
export type WidgetAuthor = ObjectType<typeof widgetAuthorArgs>

/** Shape of a comment as the widget receives it. */
export interface WidgetComment {
  _id: string
  _creationTime: number
  status: CommentStatus
  /** Can be empty when the comment is only a suggestion. */
  body: string
  suggestion?: TextSuggestion
  authorName: string
  authorKeyHash: string
  /** Written while signed in: the name and avatar come from the account. */
  signedIn?: boolean
  avatarUrl?: string
  /**
   * Public listings only include origin, path and title: they share comments
   * across origins by path, and another environment's query string may be
   * sensitive.
   */
  page: Pick<PageInfo, "origin" | "path" | "title"> &
    Partial<Pick<PageInfo, "search" | "hash" | "url">>
  anchor: Anchor
  viewport: Viewport
  createdAt: number
  editedAt?: number
  resolvedAt?: number
  /** Resolved by closing it as outdated, rather than by a fix. */
  resolution?: Resolution
  /** Visitors' widgets can't find the element on the page. */
  pinLost?: boolean
  /** Images the commenter attached; their links come with the thread. */
  imageCount?: number
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
  /** Written while signed in: the name and avatar come from the account. */
  signedIn?: boolean
  avatarUrl?: string
  /** Written by the project owner (widget session, dashboard or CLI). */
  isOwner: boolean
  createdAt: number
  editedAt?: number
}

/** One emoji on a comment or reply, with who added it. */
interface ReactionSummary {
  /** The comment or reply id. */
  targetId: string
  emoji: string
  count: number
  authorKeyHashes: string[]
}

export interface Thread {
  replies: ReplyView[]
  reactions: ReactionSummary[]
  /** Links to the comment's attached images. */
  images: string[]
}

/** A comment as the owner sees it (dashboard, owner widget, agents). */
export interface OwnerComment extends WidgetComment {
  page: PageInfo
  /** Since when the element can't be found on the page. */
  pinLostAt?: number
  userAgent?: string
  context?: CommentContext
  screenshotUrl?: string | null
  /** Images the commenter attached, public like the comment. */
  imageUrls: string[]
  replies: ReplyView[]
}
