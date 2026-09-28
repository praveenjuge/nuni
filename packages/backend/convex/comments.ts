import { LIMITS } from "@nuni/shared"
import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server"
import {
  bumpPageOpen,
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
    // Public listings share comments across origins by path, so never expose
    // another environment's full URL (its query string may be sensitive).
    page: { origin: c.page.origin, path: c.page.path, title: c.page.title },
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

function searchTextFor(body: string, authorName: string) {
  return `${authorName}\n${body}`
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function clampString(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value
}

/**
 * Comments for one page (all origins). Realtime in the widget. Returns the
 * newest open comments and the most recently resolved ones, so new comments
 * are never pushed out by old ones.
 */
export const listForPage = query({
  args: { publicId: v.string(), path: v.string() },
  handler: async (ctx, { publicId, path }) => {
    const project = await projectByPublicId(ctx, publicId)
    if (!project) return []
    const byStatus = (status: "open" | "resolved", limit: number) =>
      ctx.db
        .query("comments")
        .withIndex("by_project_path_status", (q) =>
          q
            .eq("projectId", project._id)
            .eq("page.path", path)
            .eq("status", status)
        )
        .order("desc")
        .take(limit)
    const [open, resolved] = await Promise.all([
      byStatus("open", LIMITS.pageOpenLimit),
      byStatus("resolved", LIMITS.pageResolvedLimit),
    ])
    return [...open, ...resolved].map(toPublic)
  },
})

/** Pages with open comments, for the widget list. Reads maintained counts. */
export const pagesWithComments = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const project = await projectByPublicId(ctx, publicId)
    if (!project) return []
    const pages = await ctx.db
      .query("pageStats")
      .withIndex("by_project_open", (q) =>
        q.eq("projectId", project._id).gt("openCount", 0)
      )
      .order("desc")
      .take(200)
    return pages.map((p) => ({ path: p.path, count: p.openCount }))
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
    if (originOf(args.page.url) !== origin) {
      fail("invalid_page", "Page URL does not match its origin")
    }
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
      searchText: searchTextFor(body, authorName),
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
    await bumpPageOpen(ctx, project._id, clampString(args.page.path, 1000), 1)
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
    const comment = await loadOwnComment(ctx, id, authorSecret)
    const clean = cleanBody(body)
    await ctx.db.patch(id, {
      body: clean,
      searchText: searchTextFor(clean, comment.authorName),
      editedAt: Date.now(),
    })
  },
})

async function removeComment(ctx: MutationCtx, comment: Doc<"comments">) {
  await ctx.db.delete(comment._id)
  if (comment.status === "open") {
    await bumpPageOpen(ctx, comment.projectId, comment.page.path, -1)
  }
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

type WidgetAuth = { sessionToken?: string }

const widgetAuthArgs = { sessionToken: v.optional(v.string()) }

async function setStatus(
  ctx: MutationCtx,
  id: Id<"comments">,
  status: "open" | "resolved",
  widget: WidgetAuth
) {
  const comment = await ctx.db.get(id)
  if (!comment) fail("not_found", "Comment not found")
  const userId = await requireOwner(ctx, comment.projectId, widget)
  if (comment.status === status) return
  await bumpPageOpen(
    ctx,
    comment.projectId,
    comment.page.path,
    status === "open" ? 1 : -1
  )
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
  args: { id: v.id("comments"), ...widgetAuthArgs },
  handler: (ctx, { id, ...widget }) => setStatus(ctx, id, "resolved", widget),
})

export const reopen = mutation({
  args: { id: v.id("comments"), ...widgetAuthArgs },
  handler: (ctx, { id, ...widget }) => setStatus(ctx, id, "open", widget),
})

export const remove = mutation({
  args: { id: v.id("comments"), ...widgetAuthArgs },
  handler: async (ctx, { id, ...widget }) => {
    const comment = await ctx.db.get(id)
    if (!comment) return
    await requireOwner(ctx, comment.projectId, widget)
    await removeComment(ctx, comment)
  },
})

/** Dashboard list, owner only, newest first, paginated and filtered server-side. */
export const listForOwner = query({
  args: {
    publicId: v.string(),
    status: statusValidator,
    path: v.optional(v.string()),
    origin: v.optional(v.string()),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx)
    const project = await projectByPublicId(ctx, args.publicId)
    if (!user || !project || project.ownerId !== user._id) {
      return { page: [], isDone: true, continueCursor: "" }
    }
    const search = args.search?.trim()
    const base = search
      ? ctx.db
          .query("comments")
          .withSearchIndex("search_text", (q) =>
            q
              .search("searchText", search)
              .eq("projectId", project._id)
              .eq("status", args.status)
          )
      : ctx.db
          .query("comments")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", project._id).eq("status", args.status)
          )
          .order("desc")
    const filtered = base.filter((q) =>
      q.and(
        args.path ? q.eq(q.field("page.path"), args.path) : true,
        args.origin ? q.eq(q.field("page.origin"), args.origin) : true
      )
    )
    const result = await filtered.paginate(args.paginationOpts)
    return {
      ...result,
      // The owner sees the full page location for Jump to comment.
      page: result.page.map((c) => ({
        ...toPublic(c),
        page: c.page,
        userAgent: c.userAgent,
      })),
    }
  },
})

/** Filter choices for the dashboard: every page and environment seen. */
export const ownerFilters = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const user = await currentUser(ctx)
    const project = await projectByPublicId(ctx, publicId)
    if (!user || !project || project.ownerId !== user._id) {
      return { paths: [], origins: [] }
    }
    const stats = await ctx.db
      .query("pageStats")
      .withIndex("by_project_path", (q) => q.eq("projectId", project._id))
      .take(1000)
    return { paths: stats.map((p) => p.path), origins: project.origins }
  },
})

/**
 * One comment by id, for deep links to comments outside the page listing
 * window (for example old resolved ones). Public shape only.
 */
export const getById = query({
  args: { publicId: v.string(), id: v.string() },
  handler: async (ctx, { publicId, id }) => {
    const project = await projectByPublicId(ctx, publicId)
    const commentId = ctx.db.normalizeId("comments", id)
    if (!project || !commentId) return null
    const comment = await ctx.db.get(commentId)
    if (!comment || comment.projectId !== project._id) return null
    return toPublic(comment)
  },
})

/** Most open comments counted for one page by the rebuild (stays well inside transaction limits). */
const REBUILD_PATH_CAP = 4000

/**
 * One-off maintenance: recompute per-page open counts and backfill search
 * text. Work is split into small scheduled steps so no transaction hits
 * Convex's read limits. Each page's count is read and written in a single
 * transaction, so concurrent comment writes are never counted twice.
 *   npx convex run comments:rebuildPageStats
 */
export const rebuildPageStats = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.comments.rebuildSearchText, {})
    await ctx.scheduler.runAfter(0, internal.comments.rebuildProjectStats, {})
  },
})

export const rebuildSearchText = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const batch = await ctx.db
      .query("comments")
      .paginate({ numItems: 200, cursor: cursor ?? null })
    for (const c of batch.page) {
      if (c.searchText === undefined) {
        await ctx.db.patch(c._id, {
          searchText: searchTextFor(c.body, c.authorName),
        })
      }
    }
    if (!batch.isDone) {
      await ctx.scheduler.runAfter(0, internal.comments.rebuildSearchText, {
        cursor: batch.continueCursor,
      })
    }
  },
})

/**
 * Walks projects one by one. Within a project, the "paths" stage visits each
 * distinct comment path (one path per step) and recounts it exactly; the
 * "stale" stage then zeroes pageStats rows whose page has no comments left.
 */
export const rebuildProjectStats = internalMutation({
  args: {
    projectCursor: v.optional(v.union(v.string(), v.null())),
    projectId: v.optional(v.id("projects")),
    stage: v.optional(v.union(v.literal("paths"), v.literal("stale"))),
    afterPath: v.optional(v.string()),
    statsCursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const next = (rest: Record<string, unknown>) =>
      ctx.scheduler.runAfter(0, internal.comments.rebuildProjectStats, {
        projectCursor: args.projectCursor ?? null,
        ...rest,
      })

    if (!args.projectId) {
      const batch = await ctx.db
        .query("projects")
        .paginate({ numItems: 1, cursor: args.projectCursor ?? null })
      const project = batch.page[0]
      if (!project) return
      await ctx.scheduler.runAfter(0, internal.comments.rebuildProjectStats, {
        projectCursor: batch.isDone ? undefined : batch.continueCursor,
        projectId: project._id,
        stage: "paths",
      })
      return
    }
    const projectId = args.projectId

    if (args.stage !== "stale") {
      const { afterPath } = args
      const first = await ctx.db
        .query("comments")
        .withIndex("by_project_path_status", (q) =>
          afterPath === undefined
            ? q.eq("projectId", projectId)
            : q.eq("projectId", projectId).gt("page.path", afterPath)
        )
        .first()
      if (!first) {
        await next({ projectId, stage: "stale", statsCursor: null })
        return
      }
      const path = first.page.path
      const open = await ctx.db
        .query("comments")
        .withIndex("by_project_path_status", (q) =>
          q
            .eq("projectId", projectId)
            .eq("page.path", path)
            .eq("status", "open")
        )
        .take(REBUILD_PATH_CAP)
      await setPageOpen(ctx, projectId, path, open.length)
      await next({ projectId, stage: "paths", afterPath: path })
      return
    }

    const rows = await ctx.db
      .query("pageStats")
      .withIndex("by_project_path", (q) => q.eq("projectId", projectId))
      .paginate({ numItems: 100, cursor: args.statsCursor ?? null })
    for (const row of rows.page) {
      if (row.openCount === 0) continue
      const any = await ctx.db
        .query("comments")
        .withIndex("by_project_path_status", (q) =>
          q.eq("projectId", projectId).eq("page.path", row.path)
        )
        .first()
      if (!any) await ctx.db.patch(row._id, { openCount: 0 })
    }
    if (!rows.isDone) {
      await next({
        projectId,
        stage: "stale",
        statsCursor: rows.continueCursor,
      })
    } else if (args.projectCursor) {
      await ctx.scheduler.runAfter(0, internal.comments.rebuildProjectStats, {
        projectCursor: args.projectCursor,
      })
    }
  },
})

async function setPageOpen(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  path: string,
  openCount: number
) {
  const row = await ctx.db
    .query("pageStats")
    .withIndex("by_project_path", (q) =>
      q.eq("projectId", projectId).eq("path", path)
    )
    .unique()
  if (!row) await ctx.db.insert("pageStats", { projectId, path, openCount })
  else if (row.openCount !== openCount)
    await ctx.db.patch(row._id, { openCount })
}
