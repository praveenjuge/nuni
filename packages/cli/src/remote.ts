import { api } from "@nuni/backend/api"
import type { CommentStatus, OwnerComment } from "@nuni/shared"
import { ConvexHttpClient } from "convex/browser"

import { CONVEX_SITE_URL, CONVEX_URL } from "./env"

export class RemoteError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message)
  }
}

export interface LoginStart {
  deviceSecret: string
  userCode: string
  expiresAt: number
}

export type LoginPoll =
  | { status: "pending" | "denied" | "expired" }
  | {
      status: "approved"
      token: string
      expiresAt: number
      ownerName: string
      projectName: string
    }
  | { status: "slow_down" }

export interface CommentPage {
  comments: OwnerComment[]
  cursor: string | null
}

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
      limit?: number
      cursor?: string | null
    }
  ): Promise<CommentPage>
  getComment(
    publicId: string,
    token: string,
    id: string
  ): Promise<OwnerComment | null>
  setStatus(token: string, id: string, status: CommentStatus): Promise<void>
}

/** The message from a Convex error, with a stable code. */
function wrap(error: unknown): RemoteError {
  const data = (error as { data?: { code?: string; message?: string } })?.data
  if (data?.message) return new RemoteError(data.message, data.code ?? "error")
  const message = error instanceof Error ? error.message : String(error)
  if (/ArgumentValidationError|Value does not match/.test(message)) {
    return new RemoteError("That is not a valid comment ID", "invalid")
  }
  return new RemoteError(message, "network")
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
      const { status, data } = await postJson("/cli/login/start", {
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
      const { status, data } = await postJson("/cli/login/poll", {
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
      call(async () => {
        const page = await client.query(api.comments.listForAgent, {
          publicId,
          sessionToken: token,
          ...options,
        })
        return page as unknown as CommentPage
      }),

    getComment: (publicId, token, id) =>
      call(async () => {
        const comment = await client.query(api.comments.getForOwner, {
          publicId,
          id,
          sessionToken: token,
        })
        return comment as unknown as OwnerComment | null
      }),

    setStatus: (token, id, status) =>
      call(async () => {
        const fn =
          status === "resolved" ? api.comments.resolve : api.comments.reopen
        await client.mutation(fn, { id: id as never, sessionToken: token })
      }),
  }
}
