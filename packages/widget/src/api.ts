import { api } from "@nuni/backend/api"
import {
  errorMessage,
  HTTP_ROUTES,
  UPLOAD_HEADERS,
  UPLOAD_ROUTES,
  type Anchor,
  type NewCommentPayload,
  type NewReplyPayload,
  type OwnerComment,
  type PinReportPayload,
  type Resolution,
  type Thread,
  type UploadKind,
  type WidgetAuthor,
  type WidgetComment,
} from "@nuni/shared"
import { ConvexClient } from "convex/browser"
import type { FunctionReturnType } from "convex/server"

import type { ResolvedConfig } from "./config"

export type ProjectStatus = FunctionReturnType<typeof api.projects.status>
export type PageSummary = FunctionReturnType<
  typeof api.comments.pagesWithComments
>[number]
/** The signed-in commenter, as the widget shows them. */
export type Commenter = FunctionReturnType<typeof api.commenters.validate>

export type NewComment = Omit<NewCommentPayload, "publicId">

export class NuniApiError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message)
  }
}

/** Thin wrapper over the Convex client, scoped to one project. */
export class NuniApi {
  private client: ConvexClient

  constructor(private config: ResolvedConfig) {
    this.client = new ConvexClient(config.convexUrl, {
      unsavedChangesWarning: false,
      skipConvexDeploymentUrlCheck: !/\.convex\.cloud\/?$/.test(
        config.convexUrl
      ),
    })
  }

  close() {
    return this.client.close()
  }

  touch(origin: string) {
    return this.client
      .mutation(api.projects.touch, { publicId: this.config.project, origin })
      .catch(() => null)
  }

  onStatus(cb: (status: ProjectStatus) => void) {
    return this.client.onUpdate(
      api.projects.status,
      { publicId: this.config.project },
      cb,
      () => {}
    )
  }

  onPage(
    path: string,
    cb: (comments: WidgetComment[]) => void,
    onError: (e: Error) => void
  ) {
    return this.client.onUpdate(
      api.comments.listForPage,
      { publicId: this.config.project, path },
      cb,
      onError
    )
  }

  /** The visitor's own comments on every page, live. */
  onMine(author: WidgetAuthor, cb: (comments: WidgetComment[]) => void) {
    return this.client.onUpdate(
      api.comments.listMine,
      { publicId: this.config.project, ...author },
      cb,
      () => {}
    )
  }

  /** Comments on every page, newest first, live. */
  onSite(cb: (comments: WidgetComment[]) => void) {
    return this.client.onUpdate(
      api.comments.listForSite,
      { publicId: this.config.project },
      cb,
      () => {}
    )
  }

  onPages(cb: (pages: PageSummary[]) => void) {
    return this.client.onUpdate(
      api.comments.pagesWithComments,
      { publicId: this.config.project },
      cb,
      () => {}
    )
  }

  onSession(
    sessionToken: string,
    cb: (result: { valid: boolean; ownerName?: string }) => void
  ) {
    return this.client.onUpdate(
      api.sessions.validate,
      { publicId: this.config.project, sessionToken },
      cb,
      () => {}
    )
  }

  /** Who a stored commenter sign-in belongs to, live (invalid once revoked). */
  onCommenter(commenterToken: string, cb: (result: Commenter) => void) {
    return this.client.onUpdate(
      api.commenters.validate,
      { publicId: this.config.project, commenterToken },
      cb,
      () => {}
    )
  }

  /** Right after signing in: this browser's guest comments become the account's. */
  linkBrowser(authorSecret: string, commenterToken: string) {
    return this.run(
      this.client.mutation(api.commenters.linkBrowser, {
        publicId: this.config.project,
        authorSecret,
        commenterToken,
      })
    )
  }

  signOutCommenter(commenterToken: string) {
    return this.client
      .mutation(api.commenters.signOut, { commenterToken })
      .catch(() => null)
  }

  /** A comment with the owner-only context (screenshot, console, DOM). */
  onOwnerComment(
    id: string,
    sessionToken: string,
    cb: (comment: OwnerComment | null) => void
  ) {
    return this.client.onUpdate(
      api.comments.getForOwner,
      { publicId: this.config.project, id, sessionToken },
      cb,
      () => {}
    )
  }

  /** Replies and reactions of one thread, live while its card is open. */
  onThread(commentId: string, cb: (thread: Thread) => void) {
    return this.client.onUpdate(
      api.replies.listForComment,
      { publicId: this.config.project, commentId },
      cb,
      () => {}
    )
  }

  /** One comment by id, for deep links outside the page listing window. */
  getComment(id: string): Promise<WidgetComment | null> {
    return this.client
      .query(api.comments.getById, { publicId: this.config.project, id })
      .catch(() => null)
  }

  async createComment(comment: NewComment): Promise<string> {
    const payload: NewCommentPayload = {
      publicId: this.config.project,
      ...comment,
    }
    let response: Response
    try {
      response = await fetch(this.config.convexSiteUrl + HTTP_ROUTES.comments, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    } catch {
      throw new NuniApiError(
        "Couldn't reach Nuni. Check your connection.",
        "network"
      )
    }
    const data = (await response.json().catch(() => ({}))) as {
      id?: string
      code?: string
      message?: string
    }
    if (!response.ok || !data.id) {
      throw new NuniApiError(
        data.message ?? "Couldn't post the comment",
        data.code ?? "error"
      )
    }
    return data.id
  }

  /** Through the HTTP action, so replies are rate limited per IP. */
  async createReply(reply: Omit<NewReplyPayload, "publicId">): Promise<string> {
    const payload: NewReplyPayload = { publicId: this.config.project, ...reply }
    let response: Response
    try {
      response = await fetch(this.config.convexSiteUrl + HTTP_ROUTES.replies, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    } catch {
      throw new NuniApiError(
        "Couldn't reach Nuni. Check your connection.",
        "network"
      )
    }
    const data = (await response.json().catch(() => ({}))) as {
      id?: string
      code?: string
      message?: string
    }
    if (!response.ok || !data.id) {
      throw new NuniApiError(
        data.message ?? "Couldn't post the reply",
        data.code ?? "error"
      )
    }
    return data.id
  }

  /** Attach the element's screenshot (for the owner) to a just-posted comment. */
  uploadScreenshot(id: string, author: WidgetAuthor, image: Blob) {
    return this.upload("screenshot", id, author, image)
  }

  /** An image for everyone: picked, pasted or a marked-up screenshot. */
  uploadImage(id: string, author: WidgetAuthor, image: Blob) {
    return this.upload("image", id, author, image)
  }

  private async upload(
    kind: UploadKind,
    id: string,
    author: WidgetAuthor,
    image: Blob
  ) {
    const response = await fetch(
      this.config.convexSiteUrl + UPLOAD_ROUTES[kind],
      {
        method: "POST",
        headers: {
          "Content-Type": image.type,
          [UPLOAD_HEADERS.project]: this.config.project,
          [UPLOAD_HEADERS.comment]: id,
          [UPLOAD_HEADERS.author]: author.authorSecret,
          ...(author.commenterToken
            ? { [UPLOAD_HEADERS.commenter]: author.commenterToken }
            : {}),
        },
        body: image,
      }
    )
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        code?: string
        message?: string
      }
      throw new NuniApiError(
        data.message ?? "Couldn't attach the image",
        data.code ?? "error"
      )
    }
  }

  private async run<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise
    } catch (error) {
      throw new NuniApiError(
        errorMessage(error, "Something went wrong"),
        "error"
      )
    }
  }

  editOwn(id: string, author: WidgetAuthor, body: string, suggestion?: string) {
    return this.run(
      this.client.mutation(api.comments.editOwn, {
        id,
        ...author,
        body,
        suggestion,
      })
    )
  }

  deleteOwn(id: string, author: WidgetAuthor) {
    return this.run(
      this.client.mutation(api.comments.deleteOwn, {
        id,
        ...author,
      })
    )
  }

  resolve(id: string, sessionToken: string, resolution?: Resolution) {
    return this.run(
      this.client.mutation(api.comments.resolve, {
        id,
        resolution,
        sessionToken,
      })
    )
  }

  /** The owner points a comment at another element on its page. */
  repin(id: string, anchor: Anchor, sessionToken: string) {
    return this.run(
      this.client.mutation(api.comments.repin, {
        id,
        anchor,
        sessionToken,
      })
    )
  }

  /**
   * Tell the backend which pins on this page couldn't be found, or were
   * found again, so the owner can see them. Best effort.
   */
  async reportPins(path: string, lost: string[], found: string[]) {
    const payload: PinReportPayload = {
      publicId: this.config.project,
      path,
      lost,
      found,
    }
    try {
      await fetch(this.config.convexSiteUrl + HTTP_ROUTES.pins, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      })
    } catch {
      // The next page view reports again.
    }
  }

  reopen(id: string, sessionToken: string) {
    return this.run(
      this.client.mutation(api.comments.reopen, {
        id,
        sessionToken,
      })
    )
  }

  editReply(id: string, author: WidgetAuthor, body: string) {
    return this.run(
      this.client.mutation(api.replies.editOwn, {
        id,
        ...author,
        body,
      })
    )
  }

  deleteReply(id: string, author: WidgetAuthor) {
    return this.run(
      this.client.mutation(api.replies.deleteOwn, {
        id,
        ...author,
      })
    )
  }

  removeReply(id: string, sessionToken: string) {
    return this.run(
      this.client.mutation(api.replies.remove, {
        id,
        sessionToken,
      })
    )
  }

  toggleReaction(
    commentId: string,
    targetId: string,
    emoji: string,
    author: WidgetAuthor
  ) {
    return this.run(
      this.client.mutation(api.reactions.toggle, {
        publicId: this.config.project,
        commentId,
        targetId,
        emoji,
        ...author,
      })
    )
  }

  remove(id: string, sessionToken: string) {
    return this.run(
      this.client.mutation(api.comments.remove, {
        id,
        sessionToken,
      })
    )
  }
}
