import {
  DASHBOARD_ROUTES,
  dashboardUrl,
  DEFAULT_EMAIL_FREQUENCY,
  EMAIL_SEND_HOUR_UTC,
  HTTP_ROUTES,
  pageLink,
  projectRoute,
  type EmailFrequency,
} from "@nuni/shared"
import { DEV_URLS } from "@nuni/shared/build"
import type { HttpRouter } from "convex/server"
import { v, type Infer } from "convex/values"

import { api, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import {
  internalAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server"
import {
  renderDigest,
  type Digest,
  type DigestCounts,
  type DigestPage,
  type DigestStatus,
  type DigestThread,
} from "./digestEmail"
import { failure, json, postRoute } from "./httpRoutes"
import { clampString, type Ctx } from "./lib"
import { SERVER_LIMITS } from "./limits"
import { findByToken, mintToken } from "./tokens"

/**
 * The owner's activity email. Writes that the owner should hear about are
 * recorded in `emailActivity` as they happen (`recordActivity`), and the
 * project gets a time its next email is due. An hourly cron sends the due
 * ones: one email per project with everything recorded since the last, then
 * the records are deleted. A project with nothing recorded is never due, so
 * no email goes out when nothing happened.
 */

type Project = Doc<"projects">
type Activity = Doc<"emailActivity">

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export function emailFrequencyOf(project: Project): EmailFrequency {
  return project.emailFrequency ?? DEFAULT_EMAIL_FREQUENCY
}

/**
 * When the next email of this frequency goes out, after `now`: the top of
 * the hour, or `EMAIL_SEND_HOUR_UTC` that day, or that hour on Monday.
 */
export function nextSendAt(
  frequency: Exclude<EmailFrequency, "off">,
  now: number
): number {
  if (frequency === "hourly") return Math.floor(now / HOUR) * HOUR + HOUR
  const date = new Date(now)
  let at = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    EMAIL_SEND_HOUR_UTC
  )
  if (at <= now) at += DAY
  if (frequency === "weekly") {
    while (new Date(at).getUTCDay() !== 1) at += DAY
  }
  return at
}

/**
 * Note something for the owner's next email. Nothing is noted for a project
 * without an owner or with emails off, or for what the owner did themselves
 * (`actorId`).
 */
export async function recordActivity(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  event: Pick<Activity, "kind" | "commentId" | "replyId">,
  actorId?: Id<"users">
) {
  const project = await ctx.db.get(projectId)
  if (!project?.ownerId || project.deletingAt) return
  if (actorId === project.ownerId) return
  const frequency = emailFrequencyOf(project)
  if (frequency === "off") return
  await ctx.db.insert("emailActivity", { projectId, ...event })
  if (project.emailDueAt === undefined) {
    await ctx.db.patch(projectId, {
      emailDueAt: nextSendAt(frequency, Date.now()),
    })
  }
}

/** Change how often the owner is emailed. What is waiting keeps waiting. */
export async function setEmailFrequency(
  ctx: MutationCtx,
  project: Project,
  frequency: EmailFrequency
) {
  if (frequency === "off") {
    await ctx.db.patch(project._id, {
      emailFrequency: frequency,
      emailDueAt: undefined,
    })
    await discardActivity(ctx, project._id)
    return
  }
  await ctx.db.patch(project._id, {
    emailFrequency: frequency,
    emailDueAt:
      project.emailDueAt === undefined
        ? undefined
        : nextSendAt(frequency, Date.now()),
  })
}

/**
 * A new owner (or none) starts over: the default frequency, and nothing
 * waiting from the previous owner's time.
 */
export async function resetEmails(ctx: MutationCtx, project: Project) {
  await ctx.db.patch(project._id, {
    emailFrequency: undefined,
    emailDueAt: undefined,
  })
  await discardActivity(ctx, project._id)
}

/** Delete what is waiting now; activity noted after this call stays. */
async function discardActivity(ctx: MutationCtx, projectId: Id<"projects">) {
  const newest = await ctx.db
    .query("emailActivity")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first()
  if (!newest) return
  await ctx.scheduler.runAfter(0, internal.digests.discard, {
    projectId,
    through: newest._creationTime,
  })
}

/** Delete a project's waiting activity up to `through`, in batches. */
export const discard = internalMutation({
  args: { projectId: v.id("projects"), through: v.number() },
  handler: async (ctx, { projectId, through }) => {
    const rows = await ctx.db
      .query("emailActivity")
      .withIndex("by_project", (q) =>
        q.eq("projectId", projectId).lte("_creationTime", through)
      )
      .take(SERVER_LIMITS.cleanupBatch)
    for (const row of rows) await ctx.db.delete(row._id)
    if (rows.length === SERVER_LIMITS.cleanupBatch) {
      await ctx.scheduler.runAfter(0, internal.digests.discard, {
        projectId,
        through,
      })
    }
  },
})

/** Where links in an email lead: the dashboard's public origin. */
function appUrl() {
  return process.env.NUNI_APP_URL ?? DEV_URLS.app
}

/**
 * What sending needs: a Cloudflare account with Email Sending, a token for
 * it, the address to send from and the dashboard's origin. Null until all
 * are set, and then nothing is sent.
 */
function emailConfig() {
  const {
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_EMAIL_API_TOKEN: token,
    NUNI_EMAIL_FROM: from,
    NUNI_APP_URL: app,
  } = process.env
  return accountId && token && from && app ? { accountId, token, from } : null
}

interface ThreadActivity {
  isNew: boolean
  replyIds: Id<"replies">[]
  /** The first status change: what the comment was before tells the net change. */
  firstStatus?: "resolved" | "reopened"
}

function groupByComment(rows: Activity[]) {
  const threads = new Map<Id<"comments">, ThreadActivity>()
  for (const row of rows) {
    let thread = threads.get(row.commentId)
    if (!thread) {
      thread = { isNew: false, replyIds: [] }
      threads.set(row.commentId, thread)
    }
    if (row.kind === "comment") thread.isNew = true
    else if (row.kind === "reply") {
      if (row.replyId) thread.replyIds.push(row.replyId)
    } else thread.firstStatus ??= row.kind
  }
  return threads
}

/**
 * The status to report: only when the comment ended up different from how
 * it started. Resolved and then reopened again is no change.
 */
function netStatus(
  comment: Doc<"comments">,
  first: ThreadActivity["firstStatus"]
): DigestStatus | undefined {
  if (first === "resolved" && comment.status === "resolved") {
    return comment.resolution === "outdated" ? "outdated" : "resolved"
  }
  if (first === "reopened" && comment.status === "open") return "reopened"
  return undefined
}

function emailBody(body: string) {
  return body.length > SERVER_LIMITS.emailBodyMaxLength
    ? `${body.slice(0, SERVER_LIMITS.emailBodyMaxLength).trimEnd()}…`
    : body
}

/**
 * The waiting activity as an email's content, and the time of the last
 * record it covers. `content` is null when nothing is left to say: every
 * comment was deleted, or a status went back to where it started.
 */
async function pendingDigest(ctx: Ctx, project: Project) {
  const rows = await ctx.db
    .query("emailActivity")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .take(SERVER_LIMITS.emailActivityMax)
  const last = rows.at(-1)
  if (!last) return null

  const names = new Map<Id<"users">, Promise<string | undefined>>()
  const authorOf = async (row: {
    authorId?: Id<"users">
    authorName: string
  }) => {
    if (!row.authorId) return row.authorName
    let name = names.get(row.authorId)
    if (!name) {
      name = ctx.db.get(row.authorId).then((user) => user?.name)
      names.set(row.authorId, name)
    }
    return (await name) ?? row.authorName
  }

  const counts: DigestCounts = {
    comments: 0,
    replies: 0,
    resolved: 0,
    reopened: 0,
  }
  const pages = new Map<string, DigestPage>()
  let shown = 0
  let moreThreads = 0
  for (const [commentId, activity] of groupByComment(rows)) {
    const comment = await ctx.db.get(commentId)
    if (!comment) continue
    const replies = (
      await Promise.all(activity.replyIds.map((id) => ctx.db.get(id)))
    ).filter((reply) => reply !== null)
    const status = netStatus(comment, activity.firstStatus)
    if (!activity.isNew && !replies.length && !status) continue

    if (activity.isNew) counts.comments++
    counts.replies += replies.length
    if (status === "reopened") counts.reopened++
    else if (status) counts.resolved++

    if (shown >= SERVER_LIMITS.emailThreadsMax) {
      moreThreads++
      continue
    }
    shown++
    const listed = replies.slice(0, SERVER_LIMITS.emailRepliesMax)
    const thread: DigestThread = {
      author: await authorOf(comment),
      body: emailBody(comment.body),
      suggestion: comment.suggestion && emailBody(comment.suggestion.after),
      isNew: activity.isNew,
      status,
      replies: await Promise.all(
        listed.map(async (reply) => ({
          author: await authorOf(reply),
          body: emailBody(reply.body),
        }))
      ),
      moreReplies: replies.length - listed.length,
      link: pageLink(comment.page, comment._id),
    }
    const page = pages.get(comment.page.path)
    if (page) page.threads.push(thread)
    else {
      pages.set(comment.page.path, {
        path: comment.page.path,
        title: comment.page.title,
        threads: [thread],
      })
    }
  }

  const content = shown
    ? {
        projectName: project.name,
        pages: [...pages.values()],
        counts,
        moreThreads,
      }
    : null
  return { through: last._creationTime, content }
}

type DigestContent = NonNullable<
  NonNullable<Awaited<ReturnType<typeof pendingDigest>>>["content"]
>

/** The email for `content`, with a fresh link to turn the emails off. */
async function composeEmail(
  ctx: MutationCtx,
  project: Project,
  owner: Doc<"users"> & { email: string },
  content: DigestContent
) {
  const { token, hash } = await mintToken("emailUnsubscribes")
  await ctx.db.insert("emailUnsubscribes", {
    projectId: project._id,
    userId: owner._id,
    tokenHash: hash,
    expiresAt: Date.now() + SERVER_LIMITS.unsubscribeTtlMs,
  })
  const app = appUrl()
  const route = projectRoute(project.publicId)
  const digest: Digest = {
    ...content,
    projectUrl: dashboardUrl(app, route),
    settingsUrl: dashboardUrl(app, `${route}/settings`),
    unsubscribeUrl: dashboardUrl(app, DASHBOARD_ROUTES.unsubscribe, { token }),
  }
  // Mail clients show their own unsubscribe button for this; they only
  // accept an https address.
  const site = process.env.CONVEX_SITE_URL
  const oneClick = site?.startsWith("https://")
    ? `${site}${HTTP_ROUTES.unsubscribe}?token=${encodeURIComponent(token)}`
    : undefined
  return {
    to: owner.email,
    toName: clampString(owner.name, 100),
    ...renderDigest(digest),
    unsubscribeUrl: digest.unsubscribeUrl,
    oneClick,
  }
}

const emailValidator = v.object({
  to: v.string(),
  toName: v.string(),
  subject: v.string(),
  text: v.string(),
  html: v.string(),
  unsubscribeUrl: v.string(),
  oneClick: v.optional(v.string()),
})

async function ownerWithEmail(ctx: Ctx, project: Project) {
  const owner = project.ownerId ? await ctx.db.get(project.ownerId) : null
  return owner?.email ? { ...owner, email: owner.email } : null
}

/** Delete the activity an email covered; the project is due again only if more is waiting. */
async function finishDigest(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  through: number
) {
  const covered = await ctx.db
    .query("emailActivity")
    .withIndex("by_project", (q) =>
      q.eq("projectId", projectId).lte("_creationTime", through)
    )
    .collect()
  for (const row of covered) await ctx.db.delete(row._id)
  const waiting = await ctx.db
    .query("emailActivity")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first()
  const project = await ctx.db.get(projectId)
  if (!waiting && project?.emailDueAt !== undefined) {
    await ctx.db.patch(projectId, { emailDueAt: undefined })
  }
}

/** Hourly cron: start the email of every project whose time has come. */
export const sendDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const due = await ctx.db
      .query("projects")
      .withIndex("by_emailDue", (q) =>
        q.gt("emailDueAt", 0).lte("emailDueAt", now)
      )
      .take(SERVER_LIMITS.emailProjectsBatch)
    for (const project of due) {
      const frequency = emailFrequencyOf(project)
      if (!project.ownerId || project.deletingAt || frequency === "off") {
        await ctx.db.patch(project._id, { emailDueAt: undefined })
        await discardActivity(ctx, project._id)
        continue
      }
      // Due again next time: if this email can't be sent, what it covers
      // goes out with the next one.
      await ctx.db.patch(project._id, {
        emailDueAt: nextSendAt(frequency, now),
      })
      await ctx.scheduler.runAfter(0, internal.digests.prepare, {
        projectId: project._id,
      })
    }
    if (due.length === SERVER_LIMITS.emailProjectsBatch) {
      await ctx.scheduler.runAfter(0, internal.digests.sendDue, {})
    }
    return due.length
  },
})

/** Write one project's email and hand it to `deliver`. */
export const prepare = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId)
    if (!project || project.deletingAt) return "gone"
    const owner = await ownerWithEmail(ctx, project)
    if (!owner || emailFrequencyOf(project) === "off") {
      await ctx.db.patch(projectId, { emailDueAt: undefined })
      await discardActivity(ctx, projectId)
      return "no_recipient"
    }
    const pending = await pendingDigest(ctx, project)
    if (!pending) {
      await ctx.db.patch(projectId, { emailDueAt: undefined })
      return "nothing"
    }
    if (!pending.content) {
      await finishDigest(ctx, projectId, pending.through)
      return "nothing"
    }
    await ctx.scheduler.runAfter(0, internal.digests.deliver, {
      projectId,
      through: pending.through,
      email: await composeEmail(ctx, project, owner, pending.content),
      attempt: 0,
    })
    return "scheduled"
  },
})

/**
 * Send through Cloudflare Email Sending. "retry" is for failures that may
 * pass (rate limits, their errors, the network); "rejected" is for an email
 * or a setup Cloudflare won't take, where trying again can't help.
 */
async function sendEmail(
  email: Infer<typeof emailValidator>
): Promise<"sent" | "skipped" | "retry" | "rejected"> {
  const config = emailConfig()
  if (!config) {
    console.log(`Email is not set up. Not sent: "${email.subject}"`)
    return "skipped"
  }
  const headers = email.oneClick
    ? {
        "List-Unsubscribe": `<${email.oneClick}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }
    : undefined
  let response: Response
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/email/sending/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // The REST API names the address `address`; `email` is the
          // Workers binding's name for it and is rejected here.
          from: { address: config.from, name: "Nuni" },
          to: { address: email.to, name: email.toName },
          subject: email.subject,
          text: email.text,
          html: email.html,
          headers,
        }),
      }
    )
  } catch (error) {
    console.error("Email could not reach Cloudflare", error)
    return "retry"
  }
  if (response.ok) return "sent"
  const detail = await response.text().catch(() => "")
  console.error(`Cloudflare refused an email (${response.status})`, detail)
  return response.status === 429 || response.status >= 500
    ? "retry"
    : "rejected"
}

export const deliver = internalAction({
  args: {
    projectId: v.id("projects"),
    through: v.number(),
    email: emailValidator,
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    const outcome = await sendEmail(args.email)
    if (outcome !== "retry") {
      await ctx.runMutation(internal.digests.finish, {
        projectId: args.projectId,
        through: args.through,
      })
      return outcome
    }
    const delay = SERVER_LIMITS.emailRetryDelaysMs[args.attempt]
    if (delay === undefined) {
      // Kept: the project is already due again, so the next email covers it.
      console.error("Email not sent after retries; it waits for the next one")
      return "gave_up"
    }
    await ctx.scheduler.runAfter(delay, internal.digests.deliver, {
      ...args,
      attempt: args.attempt + 1,
    })
    return outcome
  },
})

export const finish = internalMutation({
  args: { projectId: v.id("projects"), through: v.number() },
  handler: (ctx, { projectId, through }) =>
    finishDigest(ctx, projectId, through),
})

/** The project an unsubscribe link is for, while it still works for its owner. */
async function unsubscribeTarget(ctx: Ctx, token: string) {
  const link = await findByToken(ctx, "emailUnsubscribes", token)
  if (!link) return null
  const project = await ctx.db.get(link.projectId)
  return project && !project.deletingAt && project.ownerId === link.userId
    ? project
    : null
}

/** What the unsubscribe page shows before the person confirms. */
export const unsubscribeStatus = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const project = await unsubscribeTarget(ctx, token)
    return (
      project && {
        name: project.name,
        publicId: project.publicId,
        off: emailFrequencyOf(project) === "off",
      }
    )
  },
})

/**
 * Turn a project's emails off with the link from one of them: no sign-in.
 * False when the link no longer works.
 */
export const unsubscribe = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const project = await unsubscribeTarget(ctx, token)
    if (!project) return false
    if (emailFrequencyOf(project) !== "off") {
      await setEmailFrequency(ctx, project, "off")
    }
    return true
  },
})

/**
 * The email a project would get now, without sending it or clearing what
 * is waiting. For `testing:previewDigest`.
 */
export async function previewDigest(ctx: MutationCtx, project: Project) {
  const owner = await ownerWithEmail(ctx, project)
  const pending = owner && (await pendingDigest(ctx, project))
  if (!owner || !pending?.content) return null
  const { to, subject, text, unsubscribeUrl } = await composeEmail(
    ctx,
    project,
    owner,
    pending.content
  )
  return { to, subject, text, unsubscribeUrl }
}

export function emailRoutes(http: HttpRouter) {
  /** One-click unsubscribe (RFC 8058): the mail client posts here. */
  postRoute(
    http,
    HTTP_ROUTES.unsubscribe,
    "Invalid link",
    async (ctx, request) => {
      const token = new URL(request.url).searchParams.get("token") ?? ""
      const done = await ctx.runMutation(api.digests.unsubscribe, { token })
      return done
        ? json(request, 200, { ok: true })
        : failure(request, "not_found", "This link no longer works")
    }
  )
}
