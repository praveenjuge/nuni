import { api } from "@nuni/backend/api"
import {
  errorData,
  HTTP_ROUTES,
  UPLOAD_HEADERS,
  UPLOAD_ROUTES,
  type ErrorCode,
  type NewCommentPayload,
  type NewReplyPayload,
  type PinReportPayload,
  type UploadKind,
  type WidgetAuthor,
} from "@nuni/shared"
import { ConvexClient } from "convex/browser"
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server"

import type { ResolvedConfig } from "./config"

export { api }

export type ProjectStatus = FunctionReturnType<typeof api.projects.status>
export type PageSummary = FunctionReturnType<
  typeof api.comments.pagesWithComments
>[number]
type NewComment = Omit<NewCommentPayload, "publicId">

/** Why a call failed: a backend error code, or no answer at all. */
export type FailureCode = ErrorCode | "network" | "unknown"

class NuniApiError extends Error {
  constructor(public code: FailureCode) {
    super(code)
  }
}

/** The code of any error a call to Nuni threw. */
export function failureCode(error: unknown): FailureCode {
  if (error instanceof NuniApiError) return error.code
  return errorData(error).code ?? "unknown"
}

/** A query scoped to one project: the widget fills in `publicId`. */
type ProjectQuery = FunctionReference<"query", "public", { publicId: string }>

interface Live {
  args: string
  stop: () => void
}

/**
 * The widget's connection to Nuni, scoped to one project: live queries by
 * name, mutations and the HTTP routes, all failing with a `FailureCode`.
 */
export class NuniApi {
  private client: ConvexClient
  private live = new Map<string, Live>()

  constructor(
    private config: ResolvedConfig,
    /** Told about every live query that fails. */
    private report: (code: FailureCode) => void
  ) {
    this.client = new ConvexClient(config.convexUrl, {
      unsavedChangesWarning: false,
      skipConvexDeploymentUrlCheck: !/\.convex\.cloud\/?$/.test(
        config.convexUrl
      ),
    })
  }

  close() {
    for (const name of [...this.live.keys()]) this.watch(name, null)
    return this.client.close()
  }

  /**
   * Keep the query `name` subscribed with `args` (without `publicId`), or
   * stop it with null. The same args keep the running subscription; other
   * args replace it. Returns true when a new subscription started, so the
   * caller can drop what the old one delivered. A failing query is reported
   * and, with a `fallback`, answers that instead.
   */
  watch<Q extends ProjectQuery>(
    name: string,
    query: Q | null,
    args?: Omit<FunctionArgs<Q>, "publicId"> | null,
    onData?: (value: FunctionReturnType<Q>) => void,
    fallback?: FunctionReturnType<Q>
  ): boolean {
    const key = query && args ? JSON.stringify(args) : ""
    const current = this.live.get(name)
    if (current?.args === key) return false
    current?.stop()
    this.live.delete(name)
    if (!query || !args || !onData) return false
    const entry: Live = { args: key, stop: () => {} }
    this.live.set(name, entry)
    entry.stop = this.client.onUpdate(
      query,
      { ...args, publicId: this.config.project } as FunctionArgs<Q>,
      (value) => {
        if (this.live.get(name) === entry) onData(value)
      },
      (error) => {
        if (this.live.get(name) !== entry) return
        this.report(failureCode(error))
        if (fallback !== undefined) onData(fallback)
      }
    )
    return true
  }

  query<Q extends ProjectQuery>(
    query: Q,
    args: Omit<FunctionArgs<Q>, "publicId">
  ): Promise<FunctionReturnType<Q>> {
    return this.settle(
      this.client.query(query, {
        ...args,
        publicId: this.config.project,
      } as FunctionArgs<Q>)
    )
  }

  mutate<M extends FunctionReference<"mutation">>(
    mutation: M,
    args: FunctionArgs<M>
  ): Promise<FunctionReturnType<M>> {
    return this.settle(this.client.mutation(mutation, args))
  }

  private async settle<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise
    } catch (error) {
      throw new NuniApiError(failureCode(error))
    }
  }

  /** Through the HTTP action, so comments are rate limited per IP. */
  createComment(comment: NewComment) {
    const payload: NewCommentPayload = {
      publicId: this.config.project,
      ...comment,
    }
    return this.postJson(HTTP_ROUTES.comments, payload)
  }

  /** Through the HTTP action, so replies are rate limited per IP. */
  createReply(reply: Omit<NewReplyPayload, "publicId">) {
    const payload: NewReplyPayload = { publicId: this.config.project, ...reply }
    return this.postJson(HTTP_ROUTES.replies, payload)
  }

  /**
   * Attach a file to a just-posted comment: its screenshot (for the owner)
   * or an image for everyone (picked, pasted or a marked-up screenshot).
   */
  async upload(kind: UploadKind, id: string, author: WidgetAuthor, file: Blob) {
    await this.post(UPLOAD_ROUTES[kind], file, {
      "Content-Type": file.type,
      [UPLOAD_HEADERS.project]: this.config.project,
      [UPLOAD_HEADERS.comment]: id,
      [UPLOAD_HEADERS.author]: author.authorSecret,
      ...(author.commenterToken
        ? { [UPLOAD_HEADERS.commenter]: author.commenterToken }
        : {}),
    })
  }

  /**
   * Tell the backend which pins on this page couldn't be found, or were
   * found again, so the owner can see them. Best effort: the next page view
   * reports again.
   */
  reportPins(path: string, lost: string[], found: string[]) {
    const payload: PinReportPayload = {
      publicId: this.config.project,
      path,
      lost,
      found,
    }
    void this.post(HTTP_ROUTES.pins, JSON.stringify(payload), JSON_HEADERS, {
      keepalive: true,
    }).catch(() => null)
  }

  private async postJson(route: string, payload: object): Promise<string> {
    const { id } = await this.post(route, JSON.stringify(payload), JSON_HEADERS)
    if (!id) throw new NuniApiError("unknown")
    return id
  }

  private async post(
    route: string,
    body: BodyInit,
    headers: Record<string, string>,
    init?: RequestInit
  ): Promise<{ id?: string }> {
    let response: Response
    try {
      response = await fetch(this.config.convexSiteUrl + route, {
        ...init,
        method: "POST",
        headers,
        body,
      })
    } catch {
      throw new NuniApiError("network")
    }
    const data = (await response.json().catch(() => ({}))) as {
      id?: string
      code?: ErrorCode
    }
    if (!response.ok) throw new NuniApiError(data.code ?? "unknown")
    return data
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" }
