import { api } from "@nuni/backend/api"
import type {
  Anchor,
  CommentContext,
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

export interface NewComment {
  body: string
  authorName: string
  authorSecret: string
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
  async createReply(reply: {
    commentId: string
    body: string
    authorName: string
    authorSecret: string
    sessionToken?: string
  }): Promise<string> {
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

  /** Attach a screenshot to the author's own, just-posted comment. */
  async uploadScreenshot(id: string, authorSecret: string, image: Blob) {
    const response = await fetch(
      `${this.config.convexSiteUrl}/widget/screenshot`,
      {
        method: "POST",
        headers: {
          "Content-Type": image.type,
          "X-Nuni-Project": this.config.project,
          "X-Nuni-Comment": id,
          "X-Nuni-Author": authorSecret,
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
        data.message ?? "Couldn't attach the screenshot",
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

  editOwn(id: string, authorSecret: string, body: string) {
    return this.run(
      this.client.mutation(api.comments.editOwn, {
        id: id as never,
        authorSecret,
        body,
      })
    )
  }

  deleteOwn(id: string, authorSecret: string) {
    return this.run(
      this.client.mutation(api.comments.deleteOwn, {
        id: id as never,
        authorSecret,
      })
    )
  }

  resolve(id: string, sessionToken: string) {
    return this.run(
      this.client.mutation(api.comments.resolve, {
        id: id as never,
        sessionToken,
      })
    )
  }

  reopen(id: string, sessionToken: string) {
    return this.run(
      this.client.mutation(api.comments.reopen, {
        id: id as never,
        sessionToken,
      })
    )
  }

  editReply(id: string, authorSecret: string, body: string) {
    return this.run(
      this.client.mutation(api.replies.editOwn, {
        id: id as never,
        authorSecret,
        body,
      })
    )
  }

  deleteReply(id: string, authorSecret: string) {
    return this.run(
      this.client.mutation(api.replies.deleteOwn, {
        id: id as never,
        authorSecret,
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
    authorSecret: string
  ) {
    return this.run(
      this.client.mutation(api.reactions.toggle, {
        publicId: this.config.project,
        commentId,
        targetId,
        emoji,
        authorSecret,
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
