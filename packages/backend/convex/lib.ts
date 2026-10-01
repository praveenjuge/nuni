import { isProjectId, LIMITS } from "@nuni/shared"
import { ConvexError } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

type Ctx = QueryCtx | MutationCtx

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")
}

export function fail(code: string, message: string): never {
  throw new ConvexError({ code, message })
}

export function clampString(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value
}

/** A comment or reply body: trimmed, not empty, within the limit. */
export function cleanBody(body: string): string {
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

export function cleanName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, LIMITS.nameMaxLength)
  if (!clean) fail("invalid_name", "Enter your name")
  return clean
}

export function assertProjectId(publicId: string) {
  if (!isProjectId(publicId)) fail("invalid_project", "Invalid project ID")
}

export function parseOrigin(origin: string): string {
  try {
    const url = new URL(origin)
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error()
    return url.origin
  } catch {
    fail("invalid_origin", "Invalid origin")
  }
}

export function hostnameOf(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

export async function projectByPublicId(
  ctx: Ctx,
  publicId: string
): Promise<Doc<"projects"> | null> {
  if (!isProjectId(publicId)) return null
  return ctx.db
    .query("projects")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique()
}

/** Keep the per-page open comment count in sync. */
export async function bumpPageOpen(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  path: string,
  delta: number
) {
  const stats = await ctx.db
    .query("pageStats")
    .withIndex("by_project_path", (q) =>
      q.eq("projectId", projectId).eq("path", path)
    )
    .unique()
  if (stats) {
    await ctx.db.patch(stats._id, {
      openCount: Math.max(0, stats.openCount + delta),
    })
  } else {
    // Rows are kept at 0 too, so the dashboard can offer every page as a filter.
    await ctx.db.insert("pageStats", {
      projectId,
      path,
      openCount: Math.max(0, delta),
    })
  }
}

/** Create the unclaimed project on first use. */
export async function ensureProject(
  ctx: MutationCtx,
  publicId: string,
  origin: string
): Promise<Doc<"projects">> {
  assertProjectId(publicId)
  const existing = await projectByPublicId(ctx, publicId)
  if (existing?.deletingAt) {
    fail("deleting", "This project is being deleted")
  }
  if (existing) {
    if (
      !existing.origins.includes(origin) &&
      existing.origins.length < LIMITS.maxOriginsPerProject
    ) {
      await ctx.db.patch(existing._id, {
        origins: [...existing.origins, origin],
      })
      return { ...existing, origins: [...existing.origins, origin] }
    }
    return existing
  }
  const id = await ctx.db.insert("projects", {
    publicId,
    name: hostnameOf(origin),
    origins: [origin],
    commentCount: 0,
    openCount: 0,
    lastActivityAt: Date.now(),
  })
  return (await ctx.db.get(id))!
}

/** Make the user the owner of an unclaimed project, and record the claim. */
export async function claimFor(
  ctx: MutationCtx,
  project: Doc<"projects">,
  userId: Id<"users">,
  origin?: string
) {
  await ctx.db.patch(project._id, {
    ownerId: userId,
    claimedAt: Date.now(),
    lastActivityAt: Date.now(),
  })
  await ctx.db.insert("claims", { projectId: project._id, userId, origin })
}

/** The signed-in dashboard user (WorkOS JWT), if any. */
export async function currentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) return null
  return ctx.db
    .query("users")
    .withIndex("by_workosId", (q) => q.eq("workosId", identity.subject))
    .unique()
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await currentUser(ctx)
  if (!user) fail("unauthenticated", "Sign in first")
  return user
}

/** Look up a widget owner session token. */
export async function sessionFromToken(
  ctx: Ctx,
  token: string
): Promise<Doc<"widgetSessions"> | null> {
  if (!token || token.length > 200) return null
  const tokenHash = await sha256Hex(token)
  const session = await ctx.db
    .query("widgetSessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique()
  if (!session || session.expiresAt < Date.now()) return null
  return session
}

/**
 * Resolve who is acting as the owner: either the dashboard JWT or a widget
 * session token. Returns the owner user id, or throws.
 *
 * Widget session tokens are project-scoped bearer credentials. The origin
 * they were approved on is recorded for the dashboard, but it is not an
 * access check: a caller outside the browser can claim any origin. Tokens
 * are hashed at rest, expire after 30 days and can be revoked.
 */
export async function requireOwner(
  ctx: Ctx,
  projectId: Id<"projects">,
  widget?: { sessionToken?: string }
): Promise<Id<"users">> {
  const project = await ctx.db.get(projectId)
  if (!project) fail("not_found", "Project not found")
  const ownerId = await actingOwner(ctx, project, widget)
  if (!ownerId) fail("forbidden", "Only the project owner can do this")
  return ownerId
}

/** Like requireOwner, but returns null instead of throwing (for queries). */
export async function actingOwner(
  ctx: Ctx,
  project: Doc<"projects">,
  widget?: { sessionToken?: string }
): Promise<Id<"users"> | null> {
  if (!project.ownerId) return null
  if (widget?.sessionToken) {
    const session = await sessionFromToken(ctx, widget.sessionToken)
    if (
      session &&
      session.projectId === project._id &&
      project.ownerId === session.userId
    ) {
      return session.userId
    }
  }
  const user = await currentUser(ctx)
  if (user && project.ownerId === user._id) return user._id
  return null
}

/**
 * The signed-in dashboard user, who must own the project. Management
 * (transfer, release, delete, sessions) is never allowed with a widget or
 * CLI session token.
 */
export async function requireDashboardOwner(
  ctx: Ctx,
  projectId: Id<"projects">
): Promise<{ user: Doc<"users">; project: Doc<"projects"> }> {
  const user = await requireUser(ctx)
  const project = await ctx.db.get(projectId)
  if (!project || project.deletingAt) fail("not_found", "Project not found")
  if (project.ownerId !== user._id) {
    fail("forbidden", "Only the project owner can do this")
  }
  return { user, project }
}

/** Sign out every widget and CLI session of a project. */
export async function revokeSessions(
  ctx: MutationCtx,
  projectId: Id<"projects">
): Promise<number> {
  const sessions = await ctx.db
    .query("widgetSessions")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect()
  for (const session of sessions) await ctx.db.delete(session._id)
  return sessions.length
}
