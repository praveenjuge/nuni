import { LIMITS } from "@nuni/shared"
import { v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server"
import {
  ensureProject,
  fail,
  parseOrigin,
  projectByPublicId,
  requireOwner,
  sha256Hex,
  currentUser,
} from "./lib"
import { rateLimiter } from "./rateLimits"
import {
  anchorValidator,
  pageValidator,
  statusValidator,
  viewportValidator,
} from "./validators"

function toPublic(c: Doc<"comments">) {
  return {
    _id: c._id,
    _creationTime: c._creationTime,
    status: c.status,
    body: c.body,
    authorName: c.authorName,
    authorKeyHash: c.authorKeyHash,
    page: c.page,
    anchor: c.anchor,
    viewport: c.viewport,
    createdAt: c.createdAt,
    editedAt: c.editedAt,
    resolvedAt: c.resolvedAt,
  }
}

function cleanBody(body: string): string {
  const clean = body.replace(/\r\n/g, "\n").trim()
  if (!clean) fail("invalid_body", "Comment cannot be empty")
  if (clean.length > LIMITS.bodyMaxLength) {
    fail(
      "invalid_body",
      `Comments are limited to ${LIMITS.bodyMaxLength} characters`
    )
  }
  return clean
}

function cleanName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, LIMITS.nameMaxLength)
  if (!clean) fail("invalid_name", "Enter your name")
  return clean
}

function clampString(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value
}

/** Comments for one page (all origins). Realtime in the widget. */
export const listForPage = query({
  args: { publicId: v.string(), path: v.string() },
  handler: async (ctx, { publicId, path }) => {
    const project = await projectByPublicId(ctx, publicId)
    if (!project) return []
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", project._id).eq("page.path", path)
      )
      .take(500)
    return comments.map(toPublic)
  },
})

/** Other pages with open comments, for the widget list. */
export const pagesWithComments = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const project = await projectByPublicId(ctx, publicId)
    if (!project) return []
    const open = await ctx.db
      .query("comments")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", project._id).eq("status", "open")
      )
      .order("desc")
      .take(1000)
    const pages = new Map<
      string,
      { path: string; url: string; count: number }
    >()
    for (const c of open) {
      const entry = pages.get(c.page.path)
      if (entry) entry.count++
      else
        pages.set(c.page.path, { path: c.page.path, url: c.page.url, count: 1 })
    }
    return [...pages.values()].sort((a, b) => b.count - a.count)
  },
})

/** Called from the HTTP action, which supplies the client IP. */
export const createFromWidget = internalMutation({
  args: {
    publicId: v.string(),
    ip: v.string(),
    body: v.string(),
    authorName: v.string(),
    authorSecret: v.string(),
    page: pageValidator,
    anchor: anchorValidator,
    viewport: viewportValidator,
    userAgent: v.string(),
  },
  handler: async (ctx, args) => {
    const origin = parseOrigin(args.page.origin)
    const body = cleanBody(args.body)
    const authorName = cleanName(args.authorName)
    if (args.authorSecret.length < 16 || args.authorSecret.length > 128) {
      fail("invalid_author", "Invalid author key")
    }

    const perIp = await rateLimiter.limit(ctx, "commentPerIp", { key: args.ip })
    if (!perIp.ok) fail("rate_limited", "Slow down a little")
    const perProject = await rateLimiter.limit(ctx, "commentPerProject", {
      key: args.publicId,
    })
    if (!perProject.ok) fail("rate_limited", "Too many comments right now")

    const project = await ensureProject(ctx, args.publicId, origin)
    if (
      !project.ownerId &&
      project.commentCount >= LIMITS.unclaimedCommentCap
    ) {
      fail(
        "cap_reached",
        "This site has reached the comment limit for unclaimed projects. The owner can claim it to continue."
      )
    }

    const now = Date.now()
    const id = await ctx.db.insert("comments", {
      projectId: project._id,
      status: "open",
      body,
      authorName,
      authorKeyHash: await sha256Hex(args.authorSecret),
      page: {
        ...args.page,
        origin,
        title: clampString(args.page.title, 300),
        url: clampString(args.page.url, 2000),
        search: clampString(args.page.search, 1000),
        hash: clampString(args.page.hash, 1000),
        path: clampString(args.page.path, 1000),
      },
      anchor: {
        ...args.anchor,
        text: clampString(args.anchor.text, LIMITS.anchorTextMaxLength),
        ancestors: args.anchor.ancestors.slice(0, 6),
      },
      viewport: args.viewport,
      userAgent: clampString(args.userAgent, 400),
      createdAt: now,
    })
    await ctx.db.patch(project._id, {
      commentCount: project.commentCount + 1,
      openCount: project.openCount + 1,
      lastActivityAt: now,
    })
    return id
  },
})

async function loadOwnComment(
  ctx: MutationCtx,
  id: Id<"comments">,
  authorSecret: string
) {
  const comment = await ctx.db.get(id)
  if (!comment) fail("not_found", "Comment not found")
  if ((await sha256Hex(authorSecret)) !== comment.authorKeyHash) {
    fail("forbidden", "You can only change your own comments")
  }
  const { ok } = await rateLimiter.limit(ctx, "editPerAuthor", {
    key: comment.authorKeyHash,
  })
  if (!ok) fail("rate_limited", "Slow down a little")
  return comment
}

export const editOwn = mutation({
  args: { id: v.id("comments"), authorSecret: v.string(), body: v.string() },
  handler: async (ctx, { id, authorSecret, body }) => {
    await loadOwnComment(ctx, id, authorSecret)
    await ctx.db.patch(id, { body: cleanBody(body), editedAt: Date.now() })
  },
})

async function removeComment(ctx: MutationCtx, comment: Doc<"comments">) {
  await ctx.db.delete(comment._id)
  const project = await ctx.db.get(comment.projectId)
  if (project) {
    await ctx.db.patch(project._id, {
      commentCount: Math.max(0, project.commentCount - 1),
      openCount: Math.max(
        0,
        project.openCount - (comment.status === "open" ? 1 : 0)
      ),
      lastActivityAt: Date.now(),
    })
  }
}

export const deleteOwn = mutation({
  args: { id: v.id("comments"), authorSecret: v.string() },
  handler: async (ctx, { id, authorSecret }) => {
    const comment = await loadOwnComment(ctx, id, authorSecret)
    await removeComment(ctx, comment)
  },
})

async function setStatus(
  ctx: MutationCtx,
  id: Id<"comments">,
  status: "open" | "resolved",
  sessionToken?: string
) {
  const comment = await ctx.db.get(id)
  if (!comment) fail("not_found", "Comment not found")
  const userId = await requireOwner(ctx, comment.projectId, sessionToken)
  if (comment.status === status) return
  await ctx.db.patch(id, {
    status,
    resolvedAt: status === "resolved" ? Date.now() : undefined,
    resolvedBy: status === "resolved" ? userId : undefined,
  })
  const project = await ctx.db.get(comment.projectId)
  if (project) {
    await ctx.db.patch(project._id, {
      openCount: Math.max(0, project.openCount + (status === "open" ? 1 : -1)),
      lastActivityAt: Date.now(),
    })
  }
}

export const resolve = mutation({
  args: { id: v.id("comments"), sessionToken: v.optional(v.string()) },
  handler: (ctx, { id, sessionToken }) =>
    setStatus(ctx, id, "resolved", sessionToken),
})

export const reopen = mutation({
  args: { id: v.id("comments"), sessionToken: v.optional(v.string()) },
  handler: (ctx, { id, sessionToken }) =>
    setStatus(ctx, id, "open", sessionToken),
})

export const remove = mutation({
  args: { id: v.id("comments"), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { id, sessionToken }) => {
    const comment = await ctx.db.get(id)
    if (!comment) return
    await requireOwner(ctx, comment.projectId, sessionToken)
    await removeComment(ctx, comment)
  },
})

/** Dashboard list, owner only. */
export const listForOwner = query({
  args: {
    publicId: v.string(),
    status: statusValidator,
  },
  handler: async (ctx, { publicId, status }) => {
    const user = await currentUser(ctx)
    const project = await projectByPublicId(ctx, publicId)
    if (!user || !project || project.ownerId !== user._id) return null
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", project._id).eq("status", status)
      )
      .order("desc")
      .take(500)
    return comments.map((c) => ({
      ...toPublic(c),
      userAgent: c.userAgent,
    }))
  },
})
