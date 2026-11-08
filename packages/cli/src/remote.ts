import { api } from "@nuni/backend/api"
import {
  errorData,
  errorMessage,
  HTTP_ROUTES,
  type CommentStatus,
  type LoginPoll as ServerLoginPoll,
  type LoginStart,
  type OwnerComment,
} from "@nuni/shared"
import { ConvexHttpClient } from "convex/browser"
import type { FunctionReturnType } from "convex/server"

import { CONVEX_SITE_URL, CONVEX_URL } from "./env"

export class RemoteError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message)
  }
}

export type { LoginStart }

/** The server's answer, or `slow_down` when it asks the CLI to poll less. */
export type LoginPoll = ServerLoginPoll | { status: "slow_down" }

export type CommentPage = FunctionReturnType<typeof api.comments.listForAgent>

export type PageCount = FunctionReturnType<
  typeof api.comments.pagesForAgent
>[number]

/** Everything the CLI and MCP server ask the backend. */
export interface Remote {
  startLogin(publicId: string, client: string): Promise<LoginStart>
  pollLogin(deviceSecret: string): Promise<LoginPoll>
  whoami(
    publicId: string,
    token: string
  ): Promise<{ valid: boolean; ownerName?: string }>
  logout(token: string): Promise<void>
  listComments(
    publicId: string,
    token: string,
    options?: {
      status?: CommentStatus
      path?: string
      /** Words in the comment or the author's name; by relevance. */
      search?: string
      limit?: number
      cursor?: string | null
    }
  ): Promise<CommentPage>
  listPages(publicId: string, token: string): Promise<PageCount[]>
  getComment(
    publicId: string,
    token: string,
    id: string
  ): Promise<OwnerComment | null>
  setStatus(token: string, id: string, status: CommentStatus): Promise<void>
  reply(
    publicId: string,
    token: string,
    id: string,
    body: string
  ): Promise<void>
}

function wrap(error: unknown): RemoteError {
  const { code, message } = errorData(error)
  if (message) return new RemoteError(message, code ?? "error")
  return new RemoteError(errorMessage(error, String(error)), "network")
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw wrap(error)
  }
}

async function postJson(path: string, body: unknown) {
  let res: Response
  try {
    res = await fetch(`${CONVEX_SITE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new RemoteError(
      `Could not reach Nuni (${error instanceof Error ? error.message : String(error)})`,
      "network"
    )
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, data }
}

export function createRemote(): Remote {
  const client = new ConvexHttpClient(CONVEX_URL, {
    skipConvexDeploymentUrlCheck: !/\.convex\.cloud\/?$/.test(CONVEX_URL),
    logger: false,
  })

  return {
    async startLogin(publicId, clientName) {
      const { status, data } = await postJson(HTTP_ROUTES.cliLoginStart, {
        publicId,
        client: clientName,
      })
      if (status !== 201) {
        throw new RemoteError(
          String(data.message ?? `Sign-in failed (${status})`),
          String(data.code ?? "error")
        )
      }
      return data as unknown as LoginStart
    },

    async pollLogin(deviceSecret) {
      const { status, data } = await postJson(HTTP_ROUTES.cliLoginPoll, {
        deviceSecret,
      })
      if (status === 429) return { status: "slow_down" }
      if (status >= 500) {
        throw new RemoteError(String(data.message ?? "Server error"), "server")
      }
      return data as unknown as LoginPoll
    },

    whoami: (publicId, token) =>
      call(() =>
        client.query(api.sessions.validate, {
          publicId,
          sessionToken: token,
        })
      ),

    logout: (token) =>
      call(async () => {
        await client.mutation(api.sessions.revokeOwn, { sessionToken: token })
      }),

    listComments: (publicId, token, options = {}) =>
      call(() =>
        client.query(api.comments.listForAgent, {
          publicId,
          sessionToken: token,
          ...options,
        })
      ),

    listPages: (publicId, token) =>
      call(() =>
        client.query(api.comments.pagesForAgent, {
          publicId,
          sessionToken: token,
        })
      ),

    getComment: (publicId, token, id) =>
      call(() =>
        client.query(api.comments.getForOwner, {
          publicId,
          id,
          sessionToken: token,
        })
      ),

    setStatus: (token, id, status) =>
      call(async () => {
        const fn =
          status === "resolved" ? api.comments.resolve : api.comments.reopen
        await client.mutation(fn, { id, sessionToken: token })
      }),

    reply: (publicId, token, id, body) =>
      call(async () => {
        await client.mutation(api.replies.replyAsOwner, {
          publicId,
          commentId: id,
          body,
          sessionToken: token,
        })
      }),
  }
}
