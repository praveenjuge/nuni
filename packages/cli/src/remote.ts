import { api } from "@nuni/backend/api"
import {
  ERROR_STATUS,
  errorData,
  errorMessage,
  HTTP_ROUTES,
  isImageType,
  LOGIN_POLL_STATUS,
  type CommentStatus,
  type ErrorCode,
  type LoginPoll as ServerLoginPoll,
  type LoginStart,
  type OwnerComment,
} from "@nuni/shared"
import { ConvexHttpClient } from "convex/browser"
import type { FunctionReturnType } from "convex/server"

import { CONVEX_SITE_URL, CONVEX_URL } from "./env"
import { NuniError } from "./errors"

export type { LoginStart }

/** The server's answer, or `slow_down` when it asks the CLI to poll less. */
export type LoginPoll = ServerLoginPoll | { status: "slow_down" }

export type CommentPage = FunctionReturnType<typeof api.comments.listForAgent>

export type PageCount = FunctionReturnType<
  typeof api.comments.pagesForAgent
>[number]

/** One entry per id, in order: changed, or why not. */
export type StatusResult = FunctionReturnType<
  typeof api.comments.setStatusForAgent
>[number]

export interface Image {
  /** Base64. */
  data: string
  /** Always one of the image types Nuni stores. */
  mimeType: string
}

/** A `nuni login` session for one project. */
export interface Session {
  publicId: string
  token: string
}

/**
 * Everything the CLI and MCP server ask over the network. Failures throw a
 * `NuniError` with the backend's code, or `network`.
 */
export interface Remote {
  startLogin(publicId: string, client: string): Promise<LoginStart>
  pollLogin(deviceSecret: string): Promise<LoginPoll>
  whoami(session: Session): Promise<{ valid: boolean; ownerName?: string }>
  logout(token: string): Promise<void>
  listComments(
    session: Session,
    options: {
      status: CommentStatus
      path?: string
      /** Words in the comment or the author's name; by relevance. */
      search?: string
      /** The server's default when unset. */
      limit?: number
    }
  ): Promise<CommentPage>
  listPages(session: Session): Promise<PageCount[]>
  getComment(session: Session, id: string): Promise<OwnerComment | null>
  setStatus(
    session: Session,
    ids: string[],
    status: CommentStatus,
    note?: string
  ): Promise<StatusResult[]>
  reply(session: Session, id: string, body: string): Promise<void>
  /** A comment's screenshot or attached image; null when it's gone. */
  fetchImage(url: string): Promise<Image | null>
}

const unreachable = (error: unknown) =>
  new NuniError(
    `Could not reach Nuni (${errorMessage(error, String(error))})`,
    "network"
  )

async function convexCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const { code, message } = errorData(error)
    if (code && message) throw new NuniError(message, code)
    throw unreachable(error)
  }
}

/** POST JSON to an HTTP route; any answer other than `ok` is an error. */
async function postJson<T>(
  path: string,
  body: unknown,
  ok: (status: number, data: Record<string, unknown>) => boolean
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${CONVEX_SITE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw unreachable(error)
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (ok(res.status, data)) return data as T
  const code = (
    typeof data.code === "string" && data.code in ERROR_STATUS
      ? data.code
      : res.status === ERROR_STATUS.rate_limited
        ? "rate_limited"
        : "server_error"
  ) as ErrorCode
  throw new NuniError(
    typeof data.message === "string"
      ? data.message
      : `Nuni answered ${res.status}`,
    code
  )
}

/** A poll answer is a known state with the HTTP status that state has. */
function isLoginPoll(status: number, data: Record<string, unknown>) {
  const state = data.status as ServerLoginPoll["status"]
  return LOGIN_POLL_STATUS[state] === status
}

export function createRemote(): Remote {
  let client: ConvexHttpClient | undefined
  const convex = () =>
    (client ??= new ConvexHttpClient(CONVEX_URL, {
      skipConvexDeploymentUrlCheck: !/\.convex\.cloud\/?$/.test(CONVEX_URL),
      logger: false,
    }))
  const agent = ({ publicId, token }: Session) => ({
    publicId,
    sessionToken: token,
  })

  return {
    startLogin: (publicId, clientName) =>
      postJson<LoginStart>(
        HTTP_ROUTES.cliLoginStart,
        { publicId, client: clientName },
        (status) => status === 201
      ),

    async pollLogin(deviceSecret) {
      try {
        return await postJson<ServerLoginPoll>(
          HTTP_ROUTES.cliLoginPoll,
          { deviceSecret },
          isLoginPoll
        )
      } catch (error) {
        if (error instanceof NuniError && error.code === "rate_limited") {
          return { status: "slow_down" }
        }
        throw error
      }
    },

    whoami: (session) =>
      convexCall(() => convex().query(api.sessions.validate, agent(session))),

    logout: (token) =>
      convexCall(async () => {
        await convex().mutation(api.sessions.revokeOwn, { sessionToken: token })
      }),

    listComments: (session, options) =>
      convexCall(() =>
        convex().query(api.comments.listForAgent, {
          ...agent(session),
          ...options,
        })
      ),

    listPages: (session) =>
      convexCall(() =>
        convex().query(api.comments.pagesForAgent, agent(session))
      ),

    getComment: (session, id) =>
      convexCall(() =>
        convex().query(api.comments.getForAgent, { ...agent(session), id })
      ),

    setStatus: (session, ids, status, note) =>
      convexCall(() =>
        convex().mutation(api.comments.setStatusForAgent, {
          ...agent(session),
          ids,
          status,
          note,
        })
      ),

    reply: (session, id, body) =>
      convexCall(async () => {
        await convex().mutation(api.replies.replyAsOwner, {
          ...agent(session),
          commentId: id,
          body,
        })
      }),

    async fetchImage(url) {
      try {
        const res = await fetch(url)
        if (!res.ok) return null
        const type = res.headers.get("Content-Type")?.split(";")[0] ?? ""
        return {
          data: Buffer.from(await res.arrayBuffer()).toString("base64"),
          mimeType: isImageType(type) ? type : "image/webp",
        }
      } catch {
        return null
      }
    },
  }
}
