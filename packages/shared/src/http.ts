import type {
  Anchor,
  CommentContext,
  PageInfo,
  TextSuggestion,
  Viewport,
  WidgetAuthor,
} from "./types"

/**
 * The backend's HTTP routes (on the Convex site URL). Published widgets and
 * CLIs call them, so paths, headers and payload fields must never change.
 */
export const HTTP_ROUTES = {
  comments: "/widget/comments",
  replies: "/widget/replies",
  pins: "/widget/pins",
  cliLoginStart: "/cli/login/start",
  cliLoginPoll: "/cli/login/poll",
  /** `?token=`: where mail clients post a one-click unsubscribe. */
  unsubscribe: "/email/unsubscribe",
} as const

/**
 * Files the author attaches right after posting: the element's screenshot
 * (owner-only) or an image for everyone. The body is the file; the rest
 * travels in `UPLOAD_HEADERS`.
 */
export const UPLOAD_ROUTES = {
  screenshot: "/widget/screenshot",
  image: "/widget/image",
} as const

export type UploadKind = keyof typeof UPLOAD_ROUTES

export const UPLOAD_HEADERS = {
  project: "X-Nuni-Project",
  comment: "X-Nuni-Comment",
  /** The author's browser secret. */
  author: "X-Nuni-Author",
  /** The commenter's sign-in token, when signed in. */
  commenter: "X-Nuni-Commenter",
} as const

/** The image types the backend accepts, checked by the file's bytes. */
export const IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png"] as const

export const IMAGE_TYPES_TEXT = "WebP, JPEG or PNG"

export function isImageType(type: string): boolean {
  return (IMAGE_TYPES as readonly string[]).includes(type)
}

/** The body of `POST /widget/comments`. */
export interface NewCommentPayload extends WidgetAuthor {
  publicId: string
  body: string
  suggestion?: TextSuggestion
  authorName: string
  page: PageInfo
  anchor: Anchor
  viewport: Viewport
  context?: CommentContext
}

/** The body of `POST /widget/replies`. */
export interface NewReplyPayload extends WidgetAuthor {
  publicId: string
  commentId: string
  body: string
  authorName: string
  /** An owner session: the reply is the owner's. */
  sessionToken?: string
}

/** The body of `POST /widget/pins`. */
export interface PinReportPayload {
  publicId: string
  path: string
  lost: string[]
  found: string[]
}

/** `POST /cli/login/start` answers 201 with this. */
export interface LoginStart {
  deviceSecret: string
  userCode: string
  expiresAt: number
}

/** What `POST /cli/login/poll` answers, with the HTTP status of each state. */
export type LoginPoll =
  | { status: "pending" | "denied" | "expired" }
  | {
      status: "approved"
      token: string
      expiresAt: number
      ownerName: string
      projectName: string
    }

export const LOGIN_POLL_STATUS: Record<LoginPoll["status"], number> = {
  pending: 202,
  approved: 200,
  denied: 403,
  expired: 410,
}
