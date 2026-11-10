import { isProjectId, LIMITS, type ErrorCode } from "@nuni/shared"
import { ConvexError } from "convex/values"

import type { Doc } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

export type Ctx = QueryCtx | MutationCtx

export function fail(code: ErrorCode, message: string): never {
  throw new ConvexError({ code, message })
}

export function clampString(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value
}

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

/**
 * The project, or null while it is being deleted: to everything but the
 * delete itself (and `ensureProject`, which says so) it is already gone.
 */
export async function liveProject(
  ctx: Ctx,
  publicId: string
): Promise<Doc<"projects"> | null> {
  const project = await projectByPublicId(ctx, publicId)
  return project && !project.deletingAt ? project : null
}

/** A row by the id a client sent, or null when it isn't one of that table. */
export async function rowById<T extends "comments" | "replies">(
  ctx: Ctx,
  table: T,
  id: string
): Promise<Doc<T> | null> {
  const rowId = ctx.db.normalizeId(table, id)
  return rowId ? await ctx.db.get(rowId) : null
}

/** A comment by the ids a client sent, or null unless it is in that project. */
export async function findComment(
  ctx: Ctx,
  publicId: string,
  commentId: string
): Promise<{ project: Doc<"projects">; comment: Doc<"comments"> } | null> {
  const [project, comment] = await Promise.all([
    projectByPublicId(ctx, publicId),
    rowById(ctx, "comments", commentId),
  ])
  if (!project || !comment || comment.projectId !== project._id) return null
  return { project, comment }
}

export async function requireComment(
  ctx: Ctx,
  publicId: string,
  commentId: string
) {
  return (
    (await findComment(ctx, publicId, commentId)) ??
    fail("not_found", "Comment not found")
  )
}
