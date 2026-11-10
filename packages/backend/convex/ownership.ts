import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { currentUser } from "./accounts"
import { assertProjectId, fail, projectByPublicId, type Ctx } from "./lib"
import { SERVER_LIMITS } from "./limits"
import { findByToken } from "./tokens"

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

/** The project for a widget on `origin`, created unclaimed on first use. */
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
    // Origins auto-register only while a project is unclaimed. Widget owner
    // sessions are bound to this list, so once a project has an owner, new
    // origins must be added by the owner - otherwise anyone could register
    // an origin they control and pass the session origin check.
    if (
      !existing.ownerId &&
      !existing.origins.includes(origin) &&
      existing.origins.length < SERVER_LIMITS.maxOriginsPerProject
    ) {
      const origins = [...existing.origins, origin]
      await ctx.db.patch(existing._id, { origins })
      return { ...existing, origins }
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

/** Sign out every owner session (widget and CLI) of a project. */
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

export async function clearTransfers(
  ctx: MutationCtx,
  projectId: Id<"projects">
) {
  const links = await ctx.db
    .query("transfers")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect()
  for (const link of links) await ctx.db.delete(link._id)
}

/**
 * Every change of owner: a claim, a transfer, a release (`null`), or the
 * owner's account being deleted. The previous owner's sessions and transfer
 * links stop working.
 */
export async function setOwner(
  ctx: MutationCtx,
  project: Doc<"projects">,
  userId: Id<"users"> | null,
  origin?: string
) {
  if (userId) {
    const now = Date.now()
    await ctx.db.patch(project._id, {
      ownerId: userId,
      claimedAt: now,
      lastActivityAt: now,
    })
    await ctx.db.insert("claims", { projectId: project._id, userId, origin })
  } else {
    await ctx.db.patch(project._id, {
      ownerId: undefined,
      claimedAt: undefined,
    })
  }
  await revokeSessions(ctx, project._id)
  await clearTransfers(ctx, project._id)
}

/** First come, first served: the user claims the project unless someone else owns it. */
export async function claimFor(
  ctx: MutationCtx,
  project: Doc<"projects">,
  userId: Id<"users">,
  origin?: string
) {
  if (project.ownerId === userId) return { status: "already_owner" as const }
  if (project.ownerId) {
    const owner = await ctx.db.get(project.ownerId)
    return {
      status: "claimed_by_other" as const,
      ownerName: owner?.name ?? "someone else",
    }
  }
  await setOwner(ctx, project, userId, origin)
  return { status: "claimed" as const }
}

type Denied = "not_found" | "unauthenticated" | "forbidden" | "not_signed_in"

const DENIED: Record<
  Denied,
  { code: "not_found" | "unauthenticated" | "forbidden"; message: string }
> = {
  not_found: { code: "not_found", message: "Project not found" },
  unauthenticated: { code: "unauthenticated", message: "Sign in first" },
  forbidden: {
    code: "forbidden",
    message: "Only the project owner can do this",
  },
  not_signed_in: {
    code: "unauthenticated",
    message: "Not signed in to this project",
  },
}

/**
 * Who acts as the project's owner. With a session token (widget owner tools,
 * the CLI and MCP server), the token decides: anything but a live owner
 * session of this project is "not signed in to this project". Without one,
 * the signed-in dashboard user must own it. A project being deleted has no
 * owner.
 *
 * Session tokens are project-scoped bearer credentials. The origin they were
 * approved on is recorded for the dashboard, but it is not an access check:
 * a caller outside the browser can claim any origin. Tokens are hashed at
 * rest, expire and can be revoked.
 */
async function check(
  ctx: Ctx,
  project: Doc<"projects"> | null,
  sessionToken?: string
): Promise<{ userId: Id<"users"> } | { denied: Denied }> {
  const live = project && !project.deletingAt ? project : null
  if (sessionToken !== undefined) {
    const session = await findByToken(ctx, "widgetSessions", sessionToken)
    return live &&
      session?.projectId === live._id &&
      session.userId === live.ownerId
      ? { userId: session.userId }
      : { denied: "not_signed_in" }
  }
  if (!live) return { denied: "not_found" }
  const user = await currentUser(ctx)
  if (!user) return { denied: "unauthenticated" }
  return live.ownerId === user._id
    ? { userId: user._id }
    : { denied: "forbidden" }
}

/** The acting owner, or null when the caller may not act as owner. */
export async function ownerOf(
  ctx: Ctx,
  project: Doc<"projects"> | null,
  sessionToken?: string
): Promise<Id<"users"> | null> {
  const result = await check(ctx, project, sessionToken)
  return "userId" in result ? result.userId : null
}

export async function requireOwner(
  ctx: Ctx,
  project: Doc<"projects"> | null,
  sessionToken?: string
): Promise<Id<"users">> {
  const result = await check(ctx, project, sessionToken)
  if ("userId" in result) return result.userId
  const { code, message } = DENIED[result.denied]
  fail(code, message)
}

/**
 * The project, for its signed-in owner in the dashboard; null for anyone
 * else. Never with a session token: managing a project needs the dashboard.
 */
export async function dashboardProject(ctx: Ctx, publicId: string) {
  const project = await projectByPublicId(ctx, publicId)
  return (await ownerOf(ctx, project)) ? project : null
}

/**
 * The project and its acting owner: the session token's (agents), or the
 * signed-in dashboard user.
 */
export async function requireProjectOwner(
  ctx: Ctx,
  publicId: string,
  sessionToken?: string
) {
  const project = await projectByPublicId(ctx, publicId)
  const userId = await requireOwner(ctx, project, sessionToken)
  return { userId, project: project! }
}

/** The project, for its signed-in owner in the dashboard. */
export function requireDashboardProject(ctx: Ctx, publicId: string) {
  return requireProjectOwner(ctx, publicId)
}
