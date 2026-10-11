import { v } from "convex/values"

import { internal } from "./_generated/api"
import {
  action,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server"
import { authKit, displayName } from "./auth"
import { workosApiUrl } from "./auth.config"
import { currentUser, fail } from "./lib"

/** Upsert the signed-in user. Called by the dashboard after sign-in. */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) fail("unauthenticated", "Sign in first")

    const authUser = await authKit.getAuthUser(ctx).catch(() => null)
    const name =
      [authUser?.firstName, authUser?.lastName].filter(Boolean).join(" ") ||
      identity.name ||
      authUser?.email?.split("@")[0] ||
      identity.email?.split("@")[0] ||
      "Owner"
    const fields = {
      name,
      email: authUser?.email ?? identity.email ?? undefined,
      avatarUrl:
        authUser?.profilePictureUrl ?? identity.pictureUrl ?? undefined,
    }

    const existing = await currentUser(ctx)
    if (existing) {
      await ctx.db.patch(existing._id, fields)
      return existing._id
    }
    return ctx.db.insert("users", { workosId: identity.subject, ...fields })
  },
})

/**
 * Read the signed-in user's name and photo from WorkOS. Used when someone
 * signs in to comment, so their comments carry their real name from the
 * first sign-in, before the user.created webhook arrives.
 */
export const refreshProfile = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) fail("unauthenticated", "Sign in first")
    const response = await fetch(
      `${workosApiUrl().replace(/\/$/, "")}/user_management/users/${encodeURIComponent(identity.subject)}`,
      { headers: { Authorization: `Bearer ${process.env.WORKOS_API_KEY}` } }
    ).catch(() => null)
    // Keep what we have; the webhook updates it later.
    if (!response?.ok) return
    const data = (await response.json()) as {
      first_name?: string | null
      last_name?: string | null
      email?: string | null
      profile_picture_url?: string | null
    }
    await ctx.runMutation(internal.users.applyProfile, {
      workosId: identity.subject,
      name: displayName({
        firstName: data.first_name,
        lastName: data.last_name,
        email: data.email,
      }),
      email: data.email ?? undefined,
      avatarUrl: data.profile_picture_url ?? undefined,
    })
  },
})

export const applyProfile = internalMutation({
  args: {
    workosId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, { workosId, ...fields }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_workosId", (q) => q.eq("workosId", workosId))
      .unique()
    if (user) await ctx.db.patch(user._id, fields)
  },
})

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx)
    if (!user) return null
    return { _id: user._id, name: user.name, avatarUrl: user.avatarUrl }
  },
})

/**
 * WorkOS user.deleted: remove the user and their widget and commenter
 * sessions, and release
 * their projects so they can be claimed again instead of being stranded.
 */
export async function deleteUserData(ctx: MutationCtx, workosId: string) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_workosId", (q) => q.eq("workosId", workosId))
    .unique()
  if (!user) return
  const sessions = await ctx.db
    .query("widgetSessions")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect()
  for (const session of sessions) await ctx.db.delete(session._id)
  const commenterSessions = await ctx.db
    .query("commenterSessions")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect()
  for (const session of commenterSessions) await ctx.db.delete(session._id)
  const owned = await ctx.db
    .query("projects")
    .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
    .collect()
  for (const project of owned) {
    await ctx.db.patch(project._id, {
      ownerId: undefined,
      claimedAt: undefined,
    })
  }
  await ctx.db.delete(user._id)
}
