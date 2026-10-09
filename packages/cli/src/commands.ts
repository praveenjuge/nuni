import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { buildCommentPrompt, PACKAGES, type CommentStatus } from "@nuni/shared"

import {
  credentialFor,
  credentialsPath,
  removeCredential,
  saveCredential,
} from "./credentials"
import { APP_URL } from "./env"
import { formatCommentList, formatPageList, type GroupBy } from "./format"
import { fetchImage } from "./mcp"
import { resolveProject } from "./project"
import type { Remote } from "./remote"
import { resolveComments } from "./resolve"

export interface CommandContext {
  remote: Remote
  version: string
  cwd: string
  project?: string
  json: boolean
  out: (line: string) => void
  err: (line: string) => void
  /** Delay between polls; shorter in tests. */
  pollMs?: number
  openBrowser?: (url: string) => void
}

const LOGIN = `npx ${PACKAGES.cli}@latest login`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class CommandError extends Error {}

function signedIn(ctx: CommandContext) {
  const project = resolveProject(ctx.project, ctx.cwd)
  const credential = credentialFor(project.id)
  if (!credential) {
    throw new CommandError(
      `Not signed in to ${project.id}. Run \`${LOGIN}\` first.`
    )
  }
  return { publicId: project.id, token: credential.token }
}

/** Try to open the approval page, quietly: there may be no browser at all. */
export function openInBrowser(url: string) {
  if (!process.stdout.isTTY || process.env.CI || process.env.SSH_CONNECTION) {
    return
  }
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]]
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true })
    child.on("error", () => {})
    child.unref()
  } catch {
    // No browser; the URL is printed anyway.
  }
}

export async function login(ctx: CommandContext): Promise<number> {
  const project = resolveProject(ctx.project, ctx.cwd)
  const client = `nuni-cli ${ctx.version} (${process.platform}; node ${process.versions.node})`
  const start = await ctx.remote.startLogin(project.id, client)
  const url = `${APP_URL}/dashboard/cli?code=${start.userCode}`

  if (ctx.json) {
    ctx.out(JSON.stringify({ status: "waiting", url, code: start.userCode }))
  } else {
    ctx.out(`Signing in to ${project.id} (${project.source}).

  Open  ${url}
  Code  ${start.userCode}

Check that the code matches, then approve. Waiting…`)
  }
  ;(ctx.openBrowser ?? openInBrowser)(url)

  let delay = ctx.pollMs ?? 2000
  for (;;) {
    await sleep(delay)
    const result = await ctx.remote.pollLogin(start.deviceSecret)
    if (result.status === "pending") continue
    if (result.status === "slow_down") {
      delay *= 2
      continue
    }
    if (result.status === "approved") {
      saveCredential(project.id, {
        token: result.token,
        ownerName: result.ownerName,
        projectName: result.projectName,
        expiresAt: result.expiresAt,
      })
      if (ctx.json) {
        ctx.out(
          JSON.stringify({
            status: "signed_in",
            project: project.id,
            owner: result.ownerName,
          })
        )
      } else {
        ctx.out(
          `Signed in as ${result.ownerName} to ${result.projectName}. Saved to ${credentialsPath()}`
        )
      }
      return 0
    }
    const message =
      result.status === "denied"
        ? "The sign-in was denied."
        : "The code expired. Run login again."
    if (ctx.json) ctx.out(JSON.stringify({ status: result.status, message }))
    else ctx.err(message)
    return 1
  }
}

export async function logout(ctx: CommandContext): Promise<number> {
  const project = resolveProject(ctx.project, ctx.cwd)
  const credential = credentialFor(project.id)
  if (credential && !process.env.NUNI_TOKEN) {
    // Revoke it on the server too; the local copy goes either way.
    await ctx.remote.logout(credential.token).catch(() => {})
  }
  const removed = removeCredential(project.id)
  ctx.out(
    removed ? `Signed out of ${project.id}.` : `Not signed in to ${project.id}.`
  )
  return 0
}

export async function whoami(ctx: CommandContext): Promise<number> {
  const project = resolveProject(ctx.project, ctx.cwd)
  const credential = credentialFor(project.id)
  const result = credential
    ? await ctx.remote.whoami(project.id, credential.token)
    : { valid: false }
  if (ctx.json) {
    ctx.out(
      JSON.stringify({
        project: project.id,
        signedIn: result.valid,
        owner: result.ownerName ?? null,
      })
    )
  } else if (result.valid) {
    ctx.out(`Signed in to ${project.id} as ${result.ownerName}.`)
  } else {
    ctx.out(`Not signed in to ${project.id}. Run \`${LOGIN}\`.`)
  }
  return result.valid ? 0 : 1
}

export async function listComments(
  ctx: CommandContext,
  options: {
    status?: string
    page?: string
    limit?: string
    search?: string
    group?: string
  }
): Promise<number> {
  const { publicId, token } = signedIn(ctx)
  if (
    options.status &&
    options.status !== "open" &&
    options.status !== "resolved"
  ) {
    throw new CommandError(`--status must be open or resolved`)
  }
  if (
    options.group &&
    options.group !== "page" &&
    options.group !== "element"
  ) {
    throw new CommandError(`--group must be page or element`)
  }
  const status = (options.status ?? "open") as CommentStatus
  const limit = options.limit ? Number(options.limit) : 20
  if (!Number.isInteger(limit) || limit < 1) {
    throw new CommandError(`--limit must be a positive number`)
  }
  const search = options.search?.trim() || undefined
  const page = await ctx.remote.listComments(publicId, token, {
    status,
    path: options.page,
    search,
    limit,
  })
  if (ctx.json) {
    ctx.out(JSON.stringify(page, null, 2))
    return 0
  }
  ctx.out(
    formatCommentList(page.comments, {
      status,
      more: Boolean(page.cursor),
      order: search ? "best match first" : undefined,
      groupBy: options.group as GroupBy | undefined,
      detailHint: `Full context: npx ${PACKAGES.cli}@latest comment <id>`,
    })
  )
  return 0
}

export async function listPages(ctx: CommandContext): Promise<number> {
  const { publicId, token } = signedIn(ctx)
  const pages = await ctx.remote.listPages(publicId, token)
  ctx.out(ctx.json ? JSON.stringify(pages, null, 2) : formatPageList(pages))
  return 0
}

export async function showComment(
  ctx: CommandContext,
  id: string | undefined,
  options: { saveScreenshot?: string }
): Promise<number> {
  if (!id) throw new CommandError("Pass a comment id: comment <id>")
  const { publicId, token } = signedIn(ctx)
  const comment = await ctx.remote.getComment(publicId, token, id)
  if (!comment) throw new CommandError(`No comment ${id} in ${publicId}.`)
  let saved: string | null = null
  const imageFiles: string[] = []
  if (options.saveScreenshot) {
    const dir = resolve(ctx.cwd, options.saveScreenshot)
    // The screenshot keeps its old name; attached images are numbered.
    const files = [
      ...(comment.screenshotUrl
        ? [{ url: comment.screenshotUrl, name: `nuni-${comment._id}` }]
        : []),
      ...(comment.imageUrls ?? []).map((url, i) => ({
        url,
        name: `nuni-${comment._id}-image-${i + 1}`,
      })),
    ]
    for (const file of files) {
      const image = await fetchImage(file.url)
      if (!image) continue
      mkdirSync(dir, { recursive: true })
      const ext = image.mimeType.split("/")[1] ?? "webp"
      const path = join(dir, `${file.name}.${ext}`)
      writeFileSync(path, Buffer.from(image.data, "base64"))
      if (file.url === comment.screenshotUrl) saved = path
      else imageFiles.push(path)
    }
  }
  if (ctx.json) {
    ctx.out(
      JSON.stringify({ ...comment, screenshotFile: saved, imageFiles }, null, 2)
    )
    return 0
  }
  ctx.out(buildCommentPrompt(comment))
  if (saved) ctx.out(`\nScreenshot saved to ${saved}`)
  for (const path of imageFiles) ctx.out(`Image saved to ${path}`)
  return 0
}

export async function reply(
  ctx: CommandContext,
  id: string | undefined,
  body: string | undefined
): Promise<number> {
  if (!id || !body?.trim()) {
    throw new CommandError(
      'Pass a comment id and a message: reply <id> "message"'
    )
  }
  const { publicId, token } = signedIn(ctx)
  await ctx.remote.reply(publicId, token, id, body)
  ctx.out(
    ctx.json ? JSON.stringify({ id, replied: true }) : `Replied to ${id}.`
  )
  return 0
}

export async function markResolved(
  ctx: CommandContext,
  ids: string[],
  note?: string
): Promise<number> {
  if (!ids.length) throw new CommandError("Pass a comment id: resolve <id...>")
  const session = signedIn(ctx)
  if (ids.length === 1) {
    const id = ids[0]!
    // The status first: a note saying what changed is only posted once the
    // change of status went through.
    await ctx.remote.setStatus(session.token, id, "resolved")
    if (note?.trim()) {
      await ctx.remote.reply(session.publicId, session.token, id, note)
    }
    ctx.out(
      ctx.json ? JSON.stringify({ id, status: "resolved" }) : `Resolved ${id}.`
    )
    return 0
  }
  const result = await resolveComments(ctx.remote, session, ids, note)
  if (ctx.json) {
    ctx.out(JSON.stringify(result, null, 2))
  } else {
    if (result.resolved.length) {
      ctx.out(`Resolved ${result.resolved.join(", ")}.`)
    }
    for (const f of result.failed) {
      ctx.err(`Couldn't resolve ${f.id}: ${f.error}`)
    }
  }
  return result.failed.length ? 1 : 0
}

export async function reopen(
  ctx: CommandContext,
  id: string | undefined
): Promise<number> {
  if (!id) throw new CommandError(`Pass a comment id: reopen <id>`)
  const { token } = signedIn(ctx)
  await ctx.remote.setStatus(token, id, "open")
  ctx.out(ctx.json ? JSON.stringify({ id, status: "open" }) : `Reopened ${id}.`)
  return 0
}
