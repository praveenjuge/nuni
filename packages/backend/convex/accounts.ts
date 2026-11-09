import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { fail, type Ctx } from "./lib"

/** What WorkOS (or the sign-in token) says about a person. */
export interface Profile {
  firstName?: string | null
  lastName?: string | null
  /** A full name, when only that is known. */
  name?: string | null
  email?: string | null
  avatarUrl?: string | null
}

/** Shown when a person has no name at all, and for owners who are gone. */
const NO_NAME = "Owner"

/** The one rule for a person's display name. */
export function displayName(profile: Profile): string {
  const full = [profile.firstName, profile.lastName]
    .filter(Boolean)
    .join(" ")
    .trim()
  return full || profile.name?.trim() || profile.email?.split("@")[0] || NO_NAME
}

export function userByWorkosId(ctx: Ctx, workosId: string) {
  return ctx.db
    .query("users")
    .withIndex("by_workosId", (q) => q.eq("workosId", workosId))
    .unique()
}

/** Create or update the user with this WorkOS id. */
export async function upsertUser(
  ctx: MutationCtx,
  workosId: string,
  profile: Profile
): Promise<Id<"users">> {
  const fields = {
    name: displayName(profile),
    email: profile.email ?? undefined,
    avatarUrl: profile.avatarUrl ?? undefined,
  }
  const existing = await userByWorkosId(ctx, workosId)
  if (existing) {
    await ctx.db.patch(existing._id, fields)
    return existing._id
  }
  return ctx.db.insert("users", { workosId, ...fields })
}

/** The signed-in dashboard user (WorkOS JWT), if any. */
export async function currentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity()
  return identity ? userByWorkosId(ctx, identity.subject) : null
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  return (await currentUser(ctx)) ?? fail("unauthenticated", "Sign in first")
}

export async function nameOf(ctx: Ctx, userId: Id<"users">): Promise<string> {
  return (await ctx.db.get(userId))?.name ?? NO_NAME
}
