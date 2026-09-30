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
  // Cover any body the widget can accept (2,000 chars, up to 4 bytes
  // each) plus the author name, so a word near the end of a long comment
  // still matches. The per-document stored-bytes budget checked on every
  // insert is what bounds the index copy in storage.
  return clampBytes(`${authorName}\n${body}`, LIMITS.searchTextBytesMax)
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

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/** Truncate to a byte budget without splitting a multi-byte character. */
function clampBytes(value: string, maxBytes: number): string {
  if (value.length <= maxBytes / 3) return value
  const bytes = new TextEncoder().encode(value)
  if (bytes.length <= maxBytes) return value
  let end = maxBytes
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--
  return new TextDecoder().decode(bytes.subarray(0, end))
}

type StoredPage = Doc<"comments">["page"]
type StoredAnchor = Doc<"comments">["anchor"]

/**
 * Explicit clamped projections: no bulk-carrying client field enters
 * storage unbounded. Selector paths cap at 4,096 chars so real widget
 * anchors (2k+ chars on deeply nested targets) keep resolving to the
 * pinned element instead of being truncated onto a sibling. Used by
 * createFromWidget and by the oversized-legacy shrink migration.
 */
function clampPageForStorage(page: StoredPage, origin: string): StoredPage {
  return {
    origin,
    title: clampString(page.title, 300),
    url: clampString(page.url, 2000),
    search: clampString(page.search, 1000),
    hash: clampString(page.hash, 1000),
    path: clampString(page.path, 1000),
  }
}

function clampAnchorForStorage(a: StoredAnchor): StoredAnchor {
  return {
    v: a.v,
    selectors: {
      id: a.selectors.id && clampString(a.selectors.id, 256),
      testId: a.selectors.testId && clampString(a.selectors.testId, 256),
      css: a.selectors.css && clampString(a.selectors.css, 4096),
      path: clampString(a.selectors.path, 4096),
    },
    tag: clampString(a.tag, 64),
    classes: a.classes?.slice(0, 64).map((c) => clampString(c, 256)),
    role: a.role && clampString(a.role, 128),
    text: clampString(a.text, LIMITS.anchorTextMaxLength),
    attrs: Object.fromEntries(
      Object.entries(a.attrs)
        .slice(0, 64)
        .map(([key, value]) => [clampString(key, 128), clampString(value, 512)])
    ),
    ancestors: a.ancestors.slice(0, 6).map((an) => ({
      tag: clampString(an.tag, 64),
      id: an.id && clampString(an.id, 256),
      classes: an.classes.slice(0, 64).map((c) => clampString(c, 256)),
      text: an.text && clampString(an.text, LIMITS.anchorTextMaxLength),
    })),
    siblingIndex: a.siblingIndex,
    siblingCount: a.siblingCount,
    componentName: a.componentName && clampString(a.componentName, 256),
    rect: a.rect,
    offset: a.offset,
    viewport: a.viewport,
    docSize: a.docSize,
  }
}

/** Byte size of the stored payload the read-limit bound applies to. */
function storedPayloadBytes(fields: {
  body: string
  authorName: string
  searchText: string | undefined
  page: StoredPage
  anchor: StoredAnchor
  viewport: { w: number; h: number; dpr: number }
  userAgent: string
}): number {
  return byteLength(JSON.stringify(fields))
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
    // Store explicit clamped projections instead of spreading raw client
    // objects, so no bulk-carrying field can enter storage unbounded.
    const page = clampPageForStorage(args.page, origin)
    const anchor = clampAnchorForStorage(args.anchor)
    const viewport = {
      w: args.viewport.w,
      h: args.viewport.h,
      dpr: args.viewport.dpr,
    }
    const userAgent = clampString(args.userAgent, 400)
    const searchText = searchTextFor(body, authorName)
    // listForPage reads up to pageOpenLimit + pageResolvedLimit = 1200
    // documents of one page in a single transaction, and Convex aborts any
    // transaction that reads more than 16 MiB. Bound the stored payload of
    // every comment so the full window can never cross that limit.
    const storedBytes = storedPayloadBytes({
      body,
      authorName,
      searchText,
      page,
      anchor,
      viewport,
      userAgent,
    })
    if (storedBytes > LIMITS.commentStoredBytesMax) {
      fail("too_large", "Comment data too large")
    }
    const id = await ctx.db.insert("comments", {
      projectId: project._id,
      status: "open",
      body,
      authorName,
      authorKeyHash: await sha256Hex(args.authorSecret),
      searchText,
      page,
      anchor,
      viewport,
      userAgent,
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
    const searchText = searchTextFor(clean, comment.authorName)
    // An edit must keep the document inside the same stored-size budget as
    // a fresh insert, or the listForPage window bound could still be
    // crossed. A legacy document can already exceed the budget through
    // fields an edit does not change; always allow an edit that shrinks
    // the document, or it could never be brought back under the budget.
    const storedBytes = storedPayloadBytes({
      body: clean,
      authorName: comment.authorName,
      searchText,
      page: comment.page,
      anchor: comment.anchor,
      viewport: comment.viewport,
      userAgent: comment.userAgent,
    })
    const previousBytes = storedPayloadBytes({
      body: comment.body,
      authorName: comment.authorName,
      searchText: comment.searchText,
      page: comment.page,
      anchor: comment.anchor,
      viewport: comment.viewport,
      userAgent: comment.userAgent,
    })
    if (
      storedBytes > LIMITS.commentStoredBytesMax &&
      storedBytes > previousBytes
    ) {
      fail("too_large", "Comment data too large")
    }
    await ctx.db.patch(id, {
      body: clean,
      searchText,
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

/**
 * Most open comments the rebuild reads for one page, to stay well inside
 * transaction limits. At the cap the count is only a lower bound.
 */
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
    await ctx.scheduler.runAfter(
      0,
      internal.comments.shrinkOversizedComments,
      {}
    )
    await ctx.scheduler.runAfter(0, internal.comments.rebuildProjectStats, {})
  },
})

/**
 * Legacy comments written before the stored-bytes budget can still be
 * oversized enough to push a listForPage window over Convex's 16 MiB
 * transaction read limit. Re-clamp their page/anchor/userAgent fields to
 * the current projections; if a document is still too large (a maximal
 * multi-byte body), shrink the search text and finally the body until it
 * fits. Runs in small scheduled batches like the other rebuild steps.
 */
export const shrinkOversizedComments = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const batch = await ctx.db
      .query("comments")
      .paginate({ numItems: 100, cursor: cursor ?? null })
    for (const c of batch.page) {
      const current = storedPayloadBytes({
        body: c.body,
        authorName: c.authorName,
        searchText: c.searchText,
        page: c.page,
        anchor: c.anchor,
        viewport: c.viewport,
        userAgent: c.userAgent,
      })
      if (current <= LIMITS.commentStoredBytesMax) continue
      const page = clampPageForStorage(c.page, c.page.origin)
      const anchor = clampAnchorForStorage(c.anchor)
      const userAgent = clampString(c.userAgent, 400)
      let body = c.body
      let searchText = searchTextFor(body, c.authorName)
      const total = () =>
        storedPayloadBytes({
          body,
          authorName: c.authorName,
          searchText,
          page,
          anchor,
          viewport: c.viewport,
          userAgent,
        })
      let over = total() - LIMITS.commentStoredBytesMax
      if (over > 0) {
        // The index duplicates the body; shrink it before touching text
        // the author wrote.
        searchText = clampBytes(
          searchText,
          Math.max(128, byteLength(searchText) - over)
        )
        over = total() - LIMITS.commentStoredBytesMax
      }
      if (over > 0) {
        body =
          clampBytes(body, Math.max(0, byteLength(body) - over - 2)) + "\u2026"
        searchText = searchTextFor(body, c.authorName)
      }
      await ctx.db.patch(c._id, { body, searchText, page, anchor, userAgent })
    }
    if (!batch.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.comments.shrinkOversizedComments,
        { cursor: batch.continueCursor }
      )
    }
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
    /** Overrides REBUILD_PATH_CAP (tests only). */
    pathCap: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const next = (rest: Record<string, unknown>) =>
      ctx.scheduler.runAfter(0, internal.comments.rebuildProjectStats, {
        projectCursor: args.projectCursor ?? null,
        pathCap: args.pathCap,
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
        pathCap: args.pathCap,
        projectId: project._id,
        stage: "paths",
      })
      return
    }
    const projectId = args.projectId
    const cap = args.pathCap ?? REBUILD_PATH_CAP

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
        .take(cap)
      await setPageOpen(ctx, projectId, path, open.length, open.length >= cap)
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
        pathCap: args.pathCap,
      })
    }
  },
})

async function setPageOpen(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  path: string,
  openCount: number,
  capped: boolean
) {
  const row = await ctx.db
    .query("pageStats")
    .withIndex("by_project_path", (q) =>
      q.eq("projectId", projectId).eq("path", path)
    )
    .unique()
  if (!row) await ctx.db.insert("pageStats", { projectId, path, openCount })
  // A capped read is only a lower bound, so it may raise a count, never lower it.
  else if (capped ? row.openCount < openCount : row.openCount !== openCount)
    await ctx.db.patch(row._id, { openCount })
}
