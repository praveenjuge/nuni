import { api } from "@nuni/backend/api"
import type { Anchor, WidgetComment } from "@nuni/shared"
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
  url: string
  count: number
}

export interface NewComment {
  body: string
  authorName: string
  authorSecret: string
  page: WidgetComment["page"]
  anchor: Anchor
  viewport: WidgetComment["viewport"]
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
      skipConvexDeploymentUrlCheck: !/\.convex\.cloud\/?$/.test(config.convexUrl),
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

  onPage(path: string, cb: (comments: WidgetComment[]) => void, onError: (e: Error) => void) {
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

  async createComment(comment: NewComment): Promise<string> {
    let response: Response
    try {
      response = await fetch(`${this.config.convexSiteUrl}/widget/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId: this.config.project, ...comment }),
      })
    } catch {
      throw new NuniApiError("Couldn't reach Nuni. Check your connection.", "network")
    }
    const data = (await response.json().catch(() => ({}))) as {
      id?: string
      code?: string
      message?: string
    }
    if (!response.ok || !data.id) {
      throw new NuniApiError(data.message ?? "Couldn't post the comment", data.code ?? "error")
    }
    return data.id
  }

  private async run<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise
    } catch (error) {
      throw new NuniApiError(errorMessage(error), "error")
    }
  }

  editOwn(id: string, authorSecret: string, body: string) {
    return this.run(this.client.mutation(api.comments.editOwn, { id: id as never, authorSecret, body }))
  }

  deleteOwn(id: string, authorSecret: string) {
    return this.run(this.client.mutation(api.comments.deleteOwn, { id: id as never, authorSecret }))
  }

  resolve(id: string, sessionToken: string) {
    return this.run(this.client.mutation(api.comments.resolve, { id: id as never, sessionToken }))
  }

  reopen(id: string, sessionToken: string) {
    return this.run(this.client.mutation(api.comments.reopen, { id: id as never, sessionToken }))
  }

  remove(id: string, sessionToken: string) {
    return this.run(this.client.mutation(api.comments.remove, { id: id as never, sessionToken }))
  }

  signOut(sessionToken: string) {
    return this.client.mutation(api.sessions.revokeOwn, { sessionToken }).catch(() => null)
  }
}
