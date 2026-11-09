import { LIMITS, type CommentStatus, type ErrorData } from "@nuni/shared"
import {
  anchorValidator,
  contextValidator,
  pageValidator,
  resolutionValidator,
  statusValidator,
  suggestionValidator,
  viewportValidator,
  widgetAuthorArgs,
} from "@nuni/shared/validators"
import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { requireUser } from "./accounts"
import {
  authorLookup,
  findAuthor,
  requireOwnRow,
  widgetAuthor,
} from "./authors"
import {
  cleanAnchor,
  cleanCommentBody,
  cleanContext,
  cleanPage,
  cleanSuggestion,
  pageKey,
} from "./commentInput"
import {
  deleteComments,
  editComment,
  insertComment,
  insertOwnerReply,
  setStatus,
  threadIsFull,
} from "./lifecycle"
import {
  clampString,
  cleanBody,
  cleanName,
  fail,
  findComment,
  projectByPublicId,
  rowById,
} from "./lib"
import { SERVER_LIMITS } from "./limits"
import {
  dashboardProject,
  ensureProject,
  ownerOf,
  requireOwner,
} from "./ownership"
import { ipKey, rateLimiter } from "./rateLimits"
import { toOwner, toPublic } from "./views"

/**
 * The comment functions clients call by name (`comments.<name>`), so they
 * stay in this module. Published widgets and CLIs call the public ones.
 */

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
    const byStatus = (status: CommentStatus, limit: number) =>
      ctx.db
        .query("comments")
        .withIndex("by_project_path_status", (q) =>
          q
            .eq("projectId", project._id)
            .eq("page.path", pageKey(path))
            .eq("status", status)
        )
        .order("desc")
        .take(limit)
    const [open, resolved] = await Promise.all([
      byStatus("open", SERVER_LIMITS.pageOpenLimit),
      byStatus("resolved", SERVER_LIMITS.pageResolvedLimit),
    ])
    const author = authorLookup(ctx)
    return Promise.all([...open, ...resolved].map((c) => toPublic(c, author)))
  },
})

/**
 * The commenter's own comments on every page, newest first: their account's
 * when signed in, otherwise this browser's. Takes the browser key, never its
 * hash: hashes are public in every listing. Empty for an author that can't
 * write any more (signed out).
 */
export const listMine = query({
  args: { publicId: v.string(), ...widgetAuthorArgs },
  handler: async (ctx, { publicId, ...auth }) => {
    const project = await projectByPublicId(ctx, publicId)
    if (!project) return []
    const me = await findAuthor(ctx, project._id, auth)
    if (typeof me === "string") return []
    const mine = await ctx.db
      .query("comments")
      .withIndex("by_project_author", (q) =>
        q.eq("projectId", project._id).eq("authorKeyHash", me.key)
      )
      .order("desc")
      .take(SERVER_LIMITS.yoursLimit)
    const author = authorLookup(ctx)
    return Promise.all(mine.map((c) => toPublic(c, author)))
  },
})

/**
 * Comments on every page (all origins), newest first, for the widget's
 * panel. Like `listForPage`: open ones, then the most recently resolved.
 */
export const listForSite = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const project = await projectByPublicId(ctx, publicId)
    if (!project) return []
    const byStatus = (status: CommentStatus, limit: number) =>
      ctx.db
        .query("comments")
        .withIndex("by_project_status", (q) =>
          q.eq("projectId", project._id).eq("status", status)
        )
        .order("desc")
        .take(limit)
    const [open, resolved] = await Promise.all([
      byStatus("open", SERVER_LIMITS.siteOpenLimit),
      byStatus("resolved", SERVER_LIMITS.siteResolvedLimit),
    ])
    const author = authorLookup(ctx)
    return Promise.all([...open, ...resolved].map((c) => toPublic(c, author)))
  },
})

/** Pages with open comments, most first. */
function openPages(ctx: QueryCtx, projectId: Id<"projects">) {
  return ctx.db
    .query("pageStats")
    .withIndex("by_project_open", (q) =>
      q.eq("projectId", projectId).gt("openCount", 0)
    )
    .order("desc")
    .take(SERVER_LIMITS.pagesListMax)
}

/** For the widget list. */
export const pagesWithComments = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const project = await projectByPublicId(ctx, publicId)
    if (!project) return []
    const pages = await openPages(ctx, project._id)
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
    ...widgetAuthorArgs,
    suggestion: v.optional(suggestionValidator),
    page: pageValidator,
    anchor: anchorValidator,
    viewport: viewportValidator,
    context: v.optional(contextValidator),
    userAgent: v.string(),
  },
  handler: async (ctx, args) => {
    const page = cleanPage(args.page)
    const anchor = cleanAnchor(args.anchor)
    const suggestion = cleanSuggestion(args.suggestion, anchor)
    const body = cleanCommentBody(args.body, Boolean(suggestion))

    const perIp = await rateLimiter.limit(ctx, "commentPerIp", {
      key: ipKey(args.ip, args.publicId),
    })
    if (!perIp.ok) fail("rate_limited", "Slow down a little")
    const perProject = await rateLimiter.limit(ctx, "commentPerProject", {
      key: args.publicId,
    })
    if (!perProject.ok) fail("rate_limited", "Too many comments right now")

    const project = await ensureProject(ctx, args.publicId, page.origin)
    const author = await widgetAuthor(ctx, project._id, args)
    const authorName = cleanName(author.user?.name ?? args.authorName)
    if (
      !project.ownerId &&
      project.commentCount >= LIMITS.unclaimedCommentCap
    ) {
      fail(
        "cap_reached",
        "This site has reached the comment limit for unclaimed projects. The owner can claim it to continue."
      )
    }

    return insertComment(ctx, {
      projectId: project._id,
      body,
      suggestion,
      authorName,
      authorKeyHash: author.key,
      authorId: author.user?._id,
      page,
      anchor,
      viewport: args.viewport,
      context: cleanContext(args.context),
      userAgent: clampString(args.userAgent, SERVER_LIMITS.userAgentMaxLength),
    })
  },
})

export const editOwn = mutation({
  args: {
    id: v.string(),
    ...widgetAuthorArgs,
    body: v.string(),
    /** New words for a comment that suggests a text change. */
    suggestion: v.optional(v.string()),
  },
  handler: async (ctx, { id, body, suggestion: after, ...auth }) => {
    const comment = await requireOwnRow(
      ctx,
      await rowById(ctx, "comments", id),
      auth,
      "comments"
    )
    const suggestion =
      comment.suggestion && after !== undefined
        ? cleanSuggestion(
            { before: comment.suggestion.before, after },
            comment.anchor
          )
        : comment.suggestion
    await editComment(ctx, comment, {
      body: cleanCommentBody(body, Boolean(suggestion)),
      suggestion,
    })
  },
})

export const deleteOwn = mutation({
  args: { id: v.string(), ...widgetAuthorArgs },
  handler: async (ctx, { id, ...auth }) => {
    const comment = await requireOwnRow(
      ctx,
      await rowById(ctx, "comments", id),
      auth,
      "comments"
    )
    await deleteComments(ctx, [comment])
  },
})

/**
 * Owner actions on one comment take the widget's or CLI's owner session
 * token; without one, the dashboard user must be the owner.
 */
const ownerArgs = { id: v.string(), sessionToken: v.optional(v.string()) }

async function ownerComment(
  ctx: MutationCtx,
  id: string,
  sessionToken: string | undefined
) {
  const comment = await rowById(ctx, "comments", id)
  if (!comment) return null
  const userId = await requireOwner(
    ctx,
    await ctx.db.get(comment.projectId),
    sessionToken
  )
  return { comment, userId }
}

export const resolve = mutation({
  args: {
    ...ownerArgs,
    /** "outdated": closed because what it was about is gone. */
    resolution: v.optional(resolutionValidator),
  },
  handler: async (ctx, { id, sessionToken, resolution }) => {
    const found = await ownerComment(ctx, id, sessionToken)
    if (!found) fail("not_found", "Comment not found")
    await setStatus(ctx, [found.comment], "resolved", {
      userId: found.userId,
      resolution,
    })
  },
})

export const reopen = mutation({
  args: ownerArgs,
  handler: async (ctx, { id, sessionToken }) => {
    const found = await ownerComment(ctx, id, sessionToken)
    if (!found) fail("not_found", "Comment not found")
    await setStatus(ctx, [found.comment], "open", { userId: found.userId })
  },
})

/** Deleting a comment that is already gone does nothing. */
export const remove = mutation({
  args: ownerArgs,
  handler: async (ctx, { id, sessionToken }) => {
    const found = await ownerComment(ctx, id, sessionToken)
    if (found) await deleteComments(ctx, [found.comment])
  },
})

/**
 * The owner points a comment at another element on its page, for example
 * after a redesign moved it. The new anchor replaces the old one.
 */
export const repin = mutation({
  args: { ...ownerArgs, anchor: anchorValidator },
  handler: async (ctx, { id, anchor, sessionToken }) => {
    const found = await ownerComment(ctx, id, sessionToken)
    if (!found) fail("not_found", "Comment not found")
    await ctx.db.patch(found.comment._id, {
      anchor: cleanAnchor(anchor),
      pinLostAt: undefined,
    })
  },
})

const bulkArgs = { ids: v.array(v.string()) }

/**
 * Comments picked in the dashboard: all in one project the signed-in user
 * owns. Missing ids (deleted meanwhile) are skipped.
 */
async function loadBulk(ctx: MutationCtx, ids: string[]) {
  if (ids.length > LIMITS.bulkMax) {
    fail("too_many", `Pick up to ${LIMITS.bulkMax} comments at a time`)
  }
  const user = await requireUser(ctx)
  const comments = (
    await Promise.all(
      [...new Set(ids)].map((id) => rowById(ctx, "comments", id))
    )
  ).filter((c): c is Doc<"comments"> => c !== null)
  const projectIds = new Set(comments.map((c) => c.projectId))
  if (projectIds.size > 1) fail("invalid", "Comments from several projects")
  const [projectId] = projectIds
  if (projectId) await requireOwner(ctx, await ctx.db.get(projectId))
  return { userId: user._id, comments }
}

export const bulkSetStatus = mutation({
  args: {
    ...bulkArgs,
    status: statusValidator,
    resolution: v.optional(resolutionValidator),
  },
  handler: async (ctx, { ids, status, resolution }) => {
    const { userId, comments } = await loadBulk(ctx, ids)
    return setStatus(ctx, comments, status, { userId, resolution })
  },
})

export const bulkRemove = mutation({
  args: bulkArgs,
  handler: async (ctx, { ids }) => {
    const { comments } = await loadBulk(ctx, ids)
    await deleteComments(ctx, comments)
    return comments.length
  },
})

/**
 * Comments for the owner's lists (dashboard and agents): newest first, or by
 * relevance when searching, then narrowed by page and environment.
 */
function ownerComments(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  args: {
    status: CommentStatus
    path?: string
    origin?: string
    search?: string
    /** Only comments whose element visitors' widgets can't find. */
    lost?: boolean
  }
) {
  const search = args.search?.trim()
  const base = search
    ? ctx.db
        .query("comments")
        .withSearchIndex("search_text", (q) =>
          q
            .search("searchText", search)
            .eq("projectId", projectId)
            .eq("status", args.status)
        )
    : args.lost
      ? ctx.db
          .query("comments")
          .withIndex("by_project_status_lost", (q) =>
            q
              .eq("projectId", projectId)
              .eq("status", args.status)
              .gt("pinLostAt", 0)
          )
          .order("desc")
      : ctx.db
          .query("comments")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", projectId).eq("status", args.status)
          )
          .order("desc")
  return base.filter((q) =>
    q.and(
      args.path ? q.eq(q.field("page.path"), pageKey(args.path)) : true,
      args.origin ? q.eq(q.field("page.origin"), args.origin) : true,
      // The search index can't filter by `pinLostAt`.
      args.lost && search ? q.gt(q.field("pinLostAt"), 0) : true
    )
  )
}

/** The dashboard's inbox tabs. */
const VIEWS = {
  open: { status: "open", lost: false },
  /** Open comments whose element can't be found on the page. */
  lost: { status: "open", lost: true },
  resolved: { status: "resolved", lost: false },
} as const

/**
 * Dashboard list, owner only, newest first, paginated and filtered
 * server-side. `status` and `lost` are the older form of `view`.
 */
export const listForOwner = query({
  args: {
    publicId: v.string(),
    view: v.optional(
      v.union(v.literal("open"), v.literal("lost"), v.literal("resolved"))
    ),
    status: v.optional(statusValidator),
    lost: v.optional(v.boolean()),
    path: v.optional(v.string()),
    origin: v.optional(v.string()),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { view, status, lost, ...args }) => {
    const project = await dashboardProject(ctx, args)
    if (!project) return { page: [], isDone: true, continueCursor: "" }
    const tab =
      VIEWS[
        view ?? (status === "resolved" ? "resolved" : lost ? "lost" : "open")
      ]
    const result = await ownerComments(ctx, project._id, {
      ...args,
      ...tab,
    }).paginate(args.paginationOpts)
    const author = authorLookup(ctx)
    return {
      ...result,
      page: await Promise.all(result.page.map((c) => toOwner(ctx, c, author))),
    }
  },
})

/** How many open comments have lost their element, for the dashboard tab. */
export const lostCount = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const project = await dashboardProject(ctx, { publicId })
    if (!project) return 0
    const lost = await ctx.db
      .query("comments")
      .withIndex("by_project_status_lost", (q) =>
        q.eq("projectId", project._id).eq("status", "open").gt("pinLostAt", 0)
      )
      .take(LIMITS.lostCountMax + 1)
    return lost.length
  },
})

/** Filter choices for the dashboard: every page and environment seen. */
export const ownerFilters = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const project = await dashboardProject(ctx, { publicId })
    if (!project) return { paths: [], origins: [] }
    const stats = await ctx.db
      .query("pageStats")
      .withIndex("by_project_path", (q) => q.eq("projectId", project._id))
      .take(SERVER_LIMITS.pageFiltersMax)
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
    const found = await findComment(ctx, publicId, id)
    return found ? toPublic(found.comment, authorLookup(ctx)) : null
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
    const found = await findComment(ctx, publicId, id)
    if (!found || !(await ownerOf(ctx, found.project, sessionToken))) {
      return null
    }
    return toOwner(ctx, found.comment)
  },
})

/**
 * The CLI and MCP server (`nuni login` session token). Every agent function
 * throws `unauthenticated` when the token is not an owner session of this
 * project, so the agent can tell the person to log in.
 */
const agentArgs = { publicId: v.string(), sessionToken: v.string() }

async function agentOwner(
  ctx: QueryCtx | MutationCtx,
  { publicId, sessionToken }: { publicId: string; sessionToken: string }
) {
  const project = await projectByPublicId(ctx, publicId)
  const userId = await requireOwner(ctx, project, sessionToken)
  return { project: project!, userId }
}

/** Pages with open comments, most first. */
export const pagesForAgent = query({
  args: agentArgs,
  handler: async (ctx, args) => {
    const { project } = await agentOwner(ctx, args)
    const pages = await openPages(ctx, project._id)
    return pages.map((p) => ({ path: p.path, openCount: p.openCount }))
  },
})

/** Owner comments, newest first, with the full context. */
export const listForAgent = query({
  args: {
    ...agentArgs,
    status: v.optional(statusValidator),
    path: v.optional(v.string()),
    /** Words in the comment or its author's name; results by relevance. */
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { project } = await agentOwner(ctx, args)
    const numItems = Math.min(
      LIMITS.agentListMax,
      Math.max(1, Math.trunc(args.limit ?? LIMITS.agentListDefault))
    )
    const result = await ownerComments(ctx, project._id, {
      status: args.status ?? "open",
      path: args.path,
      search: args.search,
    }).paginate({ numItems, cursor: args.cursor ?? null })
    const author = authorLookup(ctx)
    return {
      comments: await Promise.all(
        result.page.map((c) => toOwner(ctx, c, author))
      ),
      cursor: result.isDone ? null : result.continueCursor,
    }
  },
})

/** One comment with the full context; null when it isn't in this project. */
export const getForAgent = query({
  args: { ...agentArgs, id: v.string() },
  handler: async (ctx, args) => {
    const { project } = await agentOwner(ctx, args)
    const comment = await rowById(ctx, "comments", args.id)
    return comment?.projectId === project._id ? toOwner(ctx, comment) : null
  },
})

export type AgentStatusResult =
  | { id: string; ok: true; changed: boolean }
  | { id: string; ok: false; error: ErrorData }

/**
 * Resolve or reopen up to `LIMITS.bulkMax` comments, each with the optional
 * note posted as an owner reply. For each id, the status and the note are
 * written together or not at all; one that fails doesn't stop the rest.
 * Results are in the order of `ids`.
 */
export const setStatusForAgent = mutation({
  args: {
    ...agentArgs,
    ids: v.array(v.string()),
    status: statusValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AgentStatusResult[]> => {
    if (args.ids.length > LIMITS.bulkMax) {
      fail("too_many", `Pick up to ${LIMITS.bulkMax} comments at a time`)
    }
    const { project, userId } = await agentOwner(ctx, args)
    const note = args.note?.trim() ? cleanBody(args.note) : undefined
    const results = new Map<string, AgentStatusResult>()
    const ready: Doc<"comments">[] = []
    const failed = (id: string, error: ErrorData) =>
      results.set(id, { id, ok: false, error })
    for (const id of new Set(args.ids)) {
      const comment = await rowById(ctx, "comments", id)
      if (comment?.projectId !== project._id) {
        failed(id, { code: "not_found", message: "Comment not found" })
      } else if (note && threadIsFull(comment)) {
        failed(id, {
          code: "cap_reached",
          message: "This thread has reached its reply limit",
        })
      } else {
        ready.push(comment)
        results.set(id, {
          id,
          ok: true,
          changed: comment.status !== args.status,
        })
      }
    }
    await setStatus(ctx, ready, args.status, { userId })
    if (note) {
      for (const comment of ready) {
        await insertOwnerReply(ctx, comment, userId, note)
      }
    }
    return args.ids.map((id) => results.get(id)!)
  },
})
