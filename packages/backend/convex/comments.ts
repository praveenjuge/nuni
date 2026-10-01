import {
  LIMITS,
  type AnchorQuote,
  stripHtmlUrlQueries,
  stripUrlQueries,
  withoutQuery,
} from "@nuni/shared"
import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import {
  actingOwner,
  bumpPageOpen,
  clampString,
  cleanBody,
  cleanName,
  ensureProject,
  fail,
  parseOrigin,
  projectByPublicId,
  requireOwner,
  requireUser,
  sha256Hex,
  currentUser,
} from "./lib"
import { rateLimiter } from "./rateLimits"
import { deleteThread, repliesFor } from "./replies"
import {
  anchorValidator,
  contextValidator,
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
    replyCount: c.replyCount ?? 0,
  }
}

/** Full shape for the owner: page URL, user agent and captured context. */
async function toOwner(ctx: QueryCtx, c: Doc<"comments">) {
  return {
    ...toPublic(c),
    page: c.page,
    userAgent: c.userAgent,
    context: c.context,
    screenshotUrl: c.screenshotId
      ? await ctx.storage.getUrl(c.screenshotId)
      : null,
    replies: c.replyCount ? await repliesFor(ctx, c._id) : [],
  }
}

type CommentContext = NonNullable<Doc<"comments">["context"]>

/**
 * Clamp everything the commenter's browser sent, entry by entry. Query
 * strings and hashes are removed here too, not only by the widget, since
 * anyone can call the endpoint directly.
 */
function cleanContext(context: CommentContext | undefined) {
  if (!context) return undefined
  const max = LIMITS.contextEntryMax
  const text = (value: string) =>
    clampString(value, LIMITS.contextMessageMaxLength)
  const out: CommentContext = {}
  if (context.console?.length) {
    out.console = context.console.slice(-max).map((e) => ({
      level: e.level,
      message: text(stripUrlQueries(e.message)),
      at: e.at,
    }))
  }
  if (context.network?.length) {
    out.network = context.network.slice(-max).map((e) => ({
      method: clampString(e.method.toUpperCase(), 10),
      url: text(withoutQuery(e.url)),
      status: Math.trunc(e.status),
      at: e.at,
    }))
  }
  if (context.dom) {
    const styles: Record<string, string> = {}
    for (const [name, value] of Object.entries(context.dom.styles).slice(
      0,
      30
    )) {
      styles[clampString(name, 40)] = clampString(stripUrlQueries(value), 200)
    }
    out.dom = {
      html: clampString(
        stripHtmlUrlQueries(context.dom.html),
        LIMITS.domSnippetMaxLength
      ),
      styles,
    }
  }
  return out.console || out.network || out.dom ? out : undefined
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

/** A text comment's words and the text around them, within the limits. */
function cleanQuote(quote: AnchorQuote | undefined): AnchorQuote | undefined {
  const exact = clampString(quote?.exact.trim() ?? "", LIMITS.quoteMaxLength)
  if (!quote || !exact) return undefined
  return {
    exact,
    prefix: clampString(quote.prefix, LIMITS.quoteContextLength),
    suffix: clampString(quote.suffix, LIMITS.quoteContextLength),
  }
}

/** An area inside the element, kept to 0..1 of its box. */
function cleanRegion(r: { x: number; y: number; w: number; h: number }) {
  const unit = (n: number) =>
    Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
  const x = unit(r.x)
  const y = unit(r.y)
  return { x, y, w: Math.min(unit(r.w), 1 - x), h: Math.min(unit(r.h), 1 - y) }
}

function cleanAnchor<A extends { text: string; ancestors: unknown[] }>(
  anchor: A
): A {
  return {
    ...anchor,
    text: clampString(anchor.text, LIMITS.anchorTextMaxLength),
    ancestors: anchor.ancestors.slice(0, 6),
  }
}

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
    context: v.optional(contextValidator),
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
        ...cleanAnchor(args.anchor),
        scope: args.anchor.scope?.slice(0, 6).map((step) => ({
          kind: step.kind,
          host: cleanAnchor(step.host),
        })),
        quote: cleanQuote(args.anchor.quote),
        region: args.anchor.region && cleanRegion(args.anchor.region),
      },
      viewport: args.viewport,
      context: cleanContext(args.context),
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

export async function removeComment(
  ctx: MutationCtx,
  comment: Doc<"comments">
) {
  await deleteThread(ctx, comment._id)
  await ctx.db.delete(comment._id)
  if (comment.screenshotId) await ctx.storage.delete(comment.screenshotId)
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

const bulkArgs = { ids: v.array(v.id("comments")) }

/**
 * Comments picked in the dashboard: all in one project the signed-in user
 * owns. Missing ids (deleted meanwhile) are skipped.
 */
async function loadBulk(ctx: MutationCtx, ids: Id<"comments">[]) {
  if (ids.length > LIMITS.bulkMax) {
    fail("too_many", `Pick up to ${LIMITS.bulkMax} comments at a time`)
  }
  const user = await requireUser(ctx)
  const comments = (
    await Promise.all([...new Set(ids)].map((id) => ctx.db.get(id)))
  ).filter((c): c is Doc<"comments"> => c !== null)
  const projectIds = new Set(comments.map((c) => c.projectId))
  if (projectIds.size > 1) fail("invalid", "Comments from several projects")
  const projectId = comments[0]?.projectId
  const project = projectId ? await ctx.db.get(projectId) : null
  if (comments.length && project?.ownerId !== user._id) {
    fail("forbidden", "Only the project owner can do this")
  }
  if (project?.deletingAt) fail("not_found", "Project not found")
  return { user, project, comments }
}

/** Open-comment counts per page, applied once for a whole batch. */
async function applyPageDeltas(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  deltas: Map<string, number>
) {
  for (const [path, delta] of deltas) {
    if (delta) await bumpPageOpen(ctx, projectId, path, delta)
  }
}

export const bulkSetStatus = mutation({
  args: { ...bulkArgs, status: statusValidator },
  handler: async (ctx, { ids, status }) => {
    const { user, project, comments } = await loadBulk(ctx, ids)
    if (!project) return 0
    const now = Date.now()
    const deltas = new Map<string, number>()
    let changed = 0
    for (const comment of comments) {
      if (comment.status === status) continue
      changed++
      const path = comment.page.path
      deltas.set(path, (deltas.get(path) ?? 0) + (status === "open" ? 1 : -1))
      await ctx.db.patch(comment._id, {
        status,
        resolvedAt: status === "resolved" ? now : undefined,
        resolvedBy: status === "resolved" ? user._id : undefined,
      })
    }
    if (!changed) return 0
    await applyPageDeltas(ctx, project._id, deltas)
    await ctx.db.patch(project._id, {
      openCount: Math.max(
        0,
        project.openCount + (status === "open" ? changed : -changed)
      ),
      lastActivityAt: now,
    })
    return changed
  },
})

export const bulkRemove = mutation({
  args: bulkArgs,
  handler: async (ctx, { ids }) => {
    const { project, comments } = await loadBulk(ctx, ids)
    if (!project) return 0
    const deltas = new Map<string, number>()
    let open = 0
    for (const comment of comments) {
      await deleteThread(ctx, comment._id)
      await ctx.db.delete(comment._id)
      if (comment.screenshotId) await ctx.storage.delete(comment.screenshotId)
      if (comment.status === "open") {
        open++
        const path = comment.page.path
        deltas.set(path, (deltas.get(path) ?? 0) - 1)
      }
    }
    await applyPageDeltas(ctx, project._id, deltas)
    await ctx.db.patch(project._id, {
      commentCount: Math.max(0, project.commentCount - comments.length),
      openCount: Math.max(0, project.openCount - open),
      lastActivityAt: Date.now(),
    })
    return comments.length
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
      // The owner sees the full page location and the captured context.
      page: await Promise.all(result.page.map((c) => toOwner(ctx, c))),
    }
  },
})

/**
 * The CLI and MCP server (`nuni login` session token): owner comments,
 * newest first, with the full context. Throws when the token is not an
 * owner session for this project, so the agent can tell the person to log in.
 */
export const listForAgent = query({
  args: {
    publicId: v.string(),
    sessionToken: v.string(),
    status: v.optional(statusValidator),
    path: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const project = await projectByPublicId(ctx, args.publicId)
    if (
      !project ||
      !(await actingOwner(ctx, project, { sessionToken: args.sessionToken }))
    ) {
      fail("unauthenticated", "Not signed in to this project")
    }
    const status = args.status ?? "open"
    const numItems = Math.min(50, Math.max(1, Math.trunc(args.limit ?? 20)))
    const result = await ctx.db
      .query("comments")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", project._id).eq("status", status)
      )
      .order("desc")
      .filter((q) => (args.path ? q.eq(q.field("page.path"), args.path) : true))
      .paginate({ numItems, cursor: args.cursor ?? null })
    return {
      comments: await Promise.all(result.page.map((c) => toOwner(ctx, c))),
      cursor: result.isDone ? null : result.continueCursor,
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
 * One comment with the owner-only fields, for the owner tools in the widget
 * (session token) and the dashboard (JWT). Null for anyone else.
 */
export const getForOwner = query({
  args: {
    publicId: v.string(),
    id: v.string(),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { publicId, id, sessionToken }) => {
    const project = await projectByPublicId(ctx, publicId)
    const commentId = ctx.db.normalizeId("comments", id)
    if (!project || !commentId) return null
    if (!(await actingOwner(ctx, project, { sessionToken }))) return null
    const comment = await ctx.db.get(commentId)
    if (!comment || comment.projectId !== project._id) return null
    return toOwner(ctx, comment)
  },
})

const SCREENSHOT_TYPES = new Set(["image/webp", "image/jpeg", "image/png"])

/**
 * Screenshot upload, step 1 (from the HTTP action): check the author and
 * rate limit before anything is stored. Returns the comment id.
 */
export const checkScreenshot = internalMutation({
  args: {
    publicId: v.string(),
    commentId: v.string(),
    authorSecret: v.string(),
    ip: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    if (!SCREENSHOT_TYPES.has(args.contentType)) {
      fail("invalid_type", "Screenshots must be WebP, JPEG or PNG")
    }
    if (args.size <= 0 || args.size > LIMITS.screenshotMaxBytes) {
      fail("too_large", "Screenshot is too large")
    }
    const { ok } = await rateLimiter.limit(ctx, "screenshotPerIp", {
      key: args.ip,
    })
    if (!ok) fail("rate_limited", "Slow down a little")
    const comment = await screenshotTarget(ctx, args)
    return comment._id
  },
})

/** Screenshot upload, step 2: attach the stored file, or report why not. */
export const attachScreenshot = internalMutation({
  args: {
    publicId: v.string(),
    commentId: v.string(),
    authorSecret: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const comment = await screenshotTarget(ctx, args)
    await ctx.db.patch(comment._id, { screenshotId: args.storageId })
  },
})

/** The author's own, recent comment that has no screenshot yet. */
async function screenshotTarget(
  ctx: MutationCtx,
  args: { publicId: string; commentId: string; authorSecret: string }
) {
  const project = await projectByPublicId(ctx, args.publicId)
  const id = ctx.db.normalizeId("comments", args.commentId)
  const comment = id ? await ctx.db.get(id) : null
  if (!project || !comment || comment.projectId !== project._id) {
    fail("not_found", "Comment not found")
  }
  if ((await sha256Hex(args.authorSecret)) !== comment.authorKeyHash) {
    fail("forbidden", "You can only add a screenshot to your own comment")
  }
  if (comment.screenshotId) fail("conflict", "This comment has a screenshot")
  if (Date.now() - comment.createdAt > LIMITS.screenshotUploadWindowMs) {
    fail("expired", "Too late to add a screenshot")
  }
  return comment
}

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
