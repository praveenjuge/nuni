import {
  DASHBOARD_ROUTES,
  dashboardUrl,
  generateProjectId,
  type CommentStatus,
  type OwnerComment,
} from "@nuni/shared"

import {
  credentialFor,
  credentialsPath,
  removeCredential,
  saveCredential,
} from "./credentials"
import { APP_URL, VERSION } from "./env"
import { NuniError } from "./errors"
import { checkProjectId, resolveProject, type ProjectRef } from "./project"
import type { CommentPage, Image, Remote, Session } from "./remote"

export interface OpsOptions {
  remote: Remote
  /** --project (or --id). */
  project?: string
  cwd: string
}

export const STATUSES = ["open", "resolved"] as const satisfies CommentStatus[]
export const GROUPS = ["page", "element"] as const

export type GroupBy = (typeof GROUPS)[number]

/** `value` if it is one of `allowed`; undefined if unset. */
export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string
): T | undefined {
  if (value === undefined) return undefined
  if (allowed.includes(value as T)) return value as T
  throw new NuniError(`${name} must be ${allowed.join(" or ")}`)
}

/** A whole number from 1 up, given as a number or text; undefined if unset. */
export function positiveInteger(
  value: unknown,
  name: string
): number | undefined {
  if (value === undefined) return undefined
  const n = typeof value === "string" ? Number(value) : value
  if (typeof n === "number" && Number.isInteger(n) && n >= 1) return n
  throw new NuniError(`${name} must be a positive number`)
}

export interface CommentList extends CommentPage {
  status: CommentStatus
  search?: string
}

export interface FetchedImage {
  kind: "image" | "screenshot"
  /** Position in the comment's `imageUrls`, for an attached image. */
  index: number
  image: Image
}

export interface StatusChange {
  status: CommentStatus
  done: string[]
  failed: { id: string; code: string; error: string }[]
}

export type LoginOutcome =
  | {
      status: "signed_in"
      project: string
      ownerName: string
      projectName: string
      savedTo: string
    }
  | { status: "denied" | "expired"; project: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * What the CLI commands and the MCP tools do, as data. They only parse their
 * input and render the results; every failure is a `NuniError`, with
 * `unauthenticated` when the person has to log in (again).
 */
export function createOps({ remote, project: flag, cwd }: OpsOptions) {
  let project: ProjectRef | undefined
  const currentProject = () => (project ??= resolveProject(flag, cwd))

  function session(): Session {
    const { id } = currentProject()
    const credential = credentialFor(id)
    if (!credential) {
      throw new NuniError(`Not signed in to ${id}`, "unauthenticated")
    }
    return { publicId: id, token: credential.token }
  }

  return {
    project: currentProject,

    /** The project ID given, or a new one: for setting up a project. */
    projectIdForSetup(): string {
      return flag ? checkProjectId(flag) : generateProjectId()
    },

    /**
     * The device flow: start a sign-in, show where to approve it, then wait
     * for the owner to approve it in the dashboard.
     */
    async login({
      onWaiting,
      pollMs = 2000,
    }: {
      onWaiting(waiting: {
        project: ProjectRef
        url: string
        code: string
      }): void
      pollMs?: number
    }): Promise<LoginOutcome> {
      const { id } = currentProject()
      const start = await remote.startLogin(
        id,
        `nuni-cli ${VERSION} (${process.platform}; node ${process.versions.node})`
      )
      onWaiting({
        project: currentProject(),
        url: dashboardUrl(APP_URL, DASHBOARD_ROUTES.cli, {
          code: start.userCode,
        }),
        code: start.userCode,
      })
      let delay = pollMs
      for (;;) {
        await sleep(delay)
        const result = await remote.pollLogin(start.deviceSecret)
        if (result.status === "pending") continue
        if (result.status === "slow_down") {
          delay *= 2
          continue
        }
        if (result.status !== "approved") {
          return { status: result.status, project: id }
        }
        saveCredential(id, {
          token: result.token,
          ownerName: result.ownerName,
          projectName: result.projectName,
          expiresAt: result.expiresAt,
        })
        return {
          status: "signed_in",
          project: id,
          ownerName: result.ownerName,
          projectName: result.projectName,
          savedTo: credentialsPath(),
        }
      }
    },

    /**
     * Forget the saved session and revoke it on the server. $NUNI_TOKEN is
     * left alone. `error` is set when the server couldn't be told.
     */
    async logout(): Promise<{
      project: string
      signedOut: boolean
      error?: NuniError
    }> {
      const { id } = currentProject()
      const saved = removeCredential(id)
      if (!saved) return { project: id, signedOut: false }
      try {
        await remote.logout(saved.token)
        return { project: id, signedOut: true }
      } catch (error) {
        if (!(error instanceof NuniError)) throw error
        return { project: id, signedOut: true, error }
      }
    },

    async whoami() {
      const { id } = currentProject()
      const credential = credentialFor(id)
      const result = credential
        ? await remote.whoami({ publicId: id, token: credential.token })
        : { valid: false }
      return {
        project: id,
        signedIn: result.valid,
        owner: result.ownerName ?? null,
      }
    },

    /** Open comments unless `status` says otherwise; the server's limit. */
    async listComments(options: {
      status?: CommentStatus
      path?: string
      search?: string
      limit?: number
    }): Promise<CommentList> {
      const status = options.status ?? "open"
      const search = options.search?.trim() || undefined
      const page = await remote.listComments(session(), {
        status,
        path: options.path,
        search,
        limit: options.limit,
      })
      return { ...page, status, search }
    },

    listPages: () => remote.listPages(session()),

    async getComment(id: string): Promise<OwnerComment> {
      const current = session()
      const comment = await remote.getComment(current, id)
      if (!comment) {
        throw new NuniError(
          `No comment ${id} in ${current.publicId}`,
          "not_found"
        )
      }
      return comment
    },

    /** The commenter's attached images, then the element's screenshot. */
    async images(comment: OwnerComment): Promise<FetchedImage[]> {
      const wanted = [
        ...comment.imageUrls.map((url, index) => ({
          kind: "image" as const,
          index,
          url,
        })),
        ...(comment.screenshotUrl
          ? [
              {
                kind: "screenshot" as const,
                index: 0,
                url: comment.screenshotUrl,
              },
            ]
          : []),
      ]
      const fetched = await Promise.all(
        wanted.map(async ({ url, ...rest }) => ({
          ...rest,
          image: await remote.fetchImage(url),
        }))
      )
      return fetched.filter((f): f is FetchedImage => f.image !== null)
    },

    reply: (id: string, body: string) => remote.reply(session(), id, body),

    /**
     * Resolve or reopen comments, each with the note as an owner reply.
     * One that fails doesn't stop the rest.
     */
    async setStatus(
      ids: string[],
      status: CommentStatus,
      note?: string
    ): Promise<StatusChange> {
      const results = await remote.setStatus(
        session(),
        [...new Set(ids)],
        status,
        note
      )
      const change: StatusChange = { status, done: [], failed: [] }
      for (const result of results) {
        if (result.ok) change.done.push(result.id)
        else {
          change.failed.push({
            id: result.id,
            code: result.error.code,
            error: result.error.message,
          })
        }
      }
      return change
    },
  }
}

export type Ops = ReturnType<typeof createOps>
