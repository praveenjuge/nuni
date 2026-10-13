import { api } from "@nuni/backend/api"
import type {
  Anchor,
  CommentContext,
  TextSuggestion,
  OwnerComment,
  Thread,
  WidgetComment,
} from "@nuni/shared"
import { ConvexClient } from "convex/browser"

import type { ResolvedConfig } from "./config"

export interface ProjectStatus {
  exists: boolean
  claimed: boolean
  ownerName: string | null
  openCount: number
}

export interface PageSummary {
  path: string
  count: number
}

/**
 * Who is writing: this browser's key, and the commenter's sign-in when they
 * signed in. The browser key is sent either way.
 */
export interface Author {
  authorSecret: string
  commenterToken?: string
}

/** The signed-in commenter, as the widget shows them. */
export type Commenter =
  | { valid: false }
  | { valid: true; name: string; avatarUrl?: string; authorKey: string }

export interface NewComment extends Author {
  body: string
  suggestion?: TextSuggestion
  authorName: string
  page: WidgetComment["page"]
  anchor: Anchor
  viewport: WidgetComment["viewport"]
  context?: CommentContext
}

export class NuniApiError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message)
  }
}

function errorMessage(error: unknown): string {
  const data = (error as { data?: { message?: string } })?.data
  if (data?.message) return data.message
  return error instanceof Error ? error.message : "Something went wrong"
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
      (comments) => cb(comments as WidgetComment[]),
      onError
    )
  }

  /** The visitor's own comments on every page, live. */
  onMine(author: Author, cb: (comments: WidgetComment[]) => void) {
    return this.client.onUpdate(
      api.comments.listMine,
      { publicId: this.config.project, ...author },
      (comments) => cb(comments as WidgetComment[]),
      () => {}
    )
  }

  /** Comments on every page, newest first, live. */
  onSite(cb: (comments: WidgetComment[]) => void) {
    return this.client.onUpdate(
      api.comments.listForSite,
      { publicId: this.config.project },
      (comments) => cb(comments as WidgetComment[]),
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
      (comment) => cb(comment as OwnerComment | null),
      () => {}
    )
  }

  /** Replies and reactions of one thread, live while its card is open. */
  onThread(commentId: string, cb: (thread: Thread) => void) {
    return this.client.onUpdate(
      api.replies.listForComment,
      { publicId: this.config.project, commentId },
      (thread) => cb(thread as Thread),
      () => {}
    )
  }

  /** One comment by id, for deep links outside the page listing window. */
  getComment(id: string): Promise<WidgetComment | null> {
    return this.client
      .query(api.comments.getById, { publicId: this.config.project, id })
      .then((c) => c as WidgetComment | null)
      .catch(() => null)
  }

  async createComment(comment: NewComment): Promise<string> {
    let response: Response
    try {
      response = await fetch(`${this.config.convexSiteUrl}/widget/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId: this.config.project, ...comment }),
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
  async createReply(
    reply: {
      commentId: string
      body: string
      authorName: string
      sessionToken?: string
    } & Author
  ): Promise<string> {
    let response: Response
    try {
      response = await fetch(`${this.config.convexSiteUrl}/widget/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId: this.config.project, ...reply }),
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
  uploadScreenshot(id: string, author: Author, image: Blob) {
    return this.upload("screenshot", id, author, image)
  }

  /** An image for everyone: picked, pasted or a marked-up screenshot. */
  uploadImage(id: string, author: Author, image: Blob) {
    return this.upload("image", id, author, image)
  }

  private async upload(
    kind: "screenshot" | "image",
    id: string,
    author: Author,
    image: Blob
  ) {
    const response = await fetch(
      `${this.config.convexSiteUrl}/widget/${kind}`,
      {
        method: "POST",
        headers: {
          "Content-Type": image.type,
          "X-Nuni-Project": this.config.project,
          "X-Nuni-Comment": id,
          "X-Nuni-Author": author.authorSecret,
          ...(author.commenterToken
            ? { "X-Nuni-Commenter": author.commenterToken }
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
      throw new NuniApiError(errorMessage(error), "error")
    }
  }

  editOwn(id: string, author: Author, body: string, suggestion?: string) {
    return this.run(
      this.client.mutation(api.comments.editOwn, {
        id: id as never,
        ...author,
        body,
        suggestion,
      })
    )
  }

  deleteOwn(id: string, author: Author) {
    return this.run(
      this.client.mutation(api.comments.deleteOwn, {
        id: id as never,
        ...author,
      })
    )
  }

  resolve(id: string, sessionToken: string, resolution?: "outdated") {
    return this.run(
      this.client.mutation(api.comments.resolve, {
        id: id as never,
        resolution,
        sessionToken,
      })
    )
  }

  /** The owner points a comment at another element on its page. */
  repin(id: string, anchor: Anchor, sessionToken: string) {
    return this.run(
      this.client.mutation(api.comments.repin, {
        id: id as never,
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
    try {
      await fetch(`${this.config.convexSiteUrl}/widget/pins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicId: this.config.project,
          path,
          lost,
          found,
        }),
        keepalive: true,
      })
    } catch {
      // The next page view reports again.
    }
  }

  reopen(id: string, sessionToken: string) {
    return this.run(
      this.client.mutation(api.comments.reopen, {
        id: id as never,
        sessionToken,
      })
    )
  }

  editReply(id: string, author: Author, body: string) {
    return this.run(
      this.client.mutation(api.replies.editOwn, {
        id: id as never,
        ...author,
        body,
      })
    )
  }

  deleteReply(id: string, author: Author) {
    return this.run(
      this.client.mutation(api.replies.deleteOwn, {
        id: id as never,
        ...author,
      })
    )
  }

  removeReply(id: string, sessionToken: string) {
    return this.run(
      this.client.mutation(api.replies.remove, {
        id: id as never,
        sessionToken,
      })
    )
  }

  toggleReaction(
    commentId: string,
    targetId: string,
    emoji: string,
    author: Author
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
        id: id as never,
        sessionToken,
      })
    )
  }
}
