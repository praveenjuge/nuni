import { v } from "convex/values"

import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  action,
  internalMutation,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server"
import { currentUser, upsertUser, type Profile } from "./accounts"
import { authKit } from "./auth"
import { workosApiUrl } from "./auth.config"
import { fail } from "./lib"

/**
 * Upsert the signed-in user. Without a fresh profile, the name and photo
 * come from the WorkOS user the webhooks stored, then the sign-in token.
 */
async function storeSignedIn(
  ctx: MutationCtx,
  fresh?: Profile
): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) fail("unauthenticated", "Sign in first")
  if (fresh) return upsertUser(ctx, identity.subject, fresh)
  const authUser = await authKit.getAuthUser(ctx).catch(() => null)
  return upsertUser(ctx, identity.subject, {
    firstName: authUser?.firstName,
    lastName: authUser?.lastName,
    name: identity.name,
    email: authUser?.email ?? identity.email,
    avatarUrl: authUser?.profilePictureUrl ?? identity.pictureUrl,
  })
}

/** Called by the dashboard after sign-in. */
export const store = mutation({
  args: {},
  handler: (ctx) => storeSignedIn(ctx),
})

const profileValidator = v.object({
  firstName: v.optional(v.union(v.string(), v.null())),
  lastName: v.optional(v.union(v.string(), v.null())),
  email: v.optional(v.union(v.string(), v.null())),
  avatarUrl: v.optional(v.union(v.string(), v.null())),
})

export const storeProfile = internalMutation({
  args: { profile: v.optional(profileValidator) },
  handler: async (ctx, { profile }) => {
    const user = (await ctx.db.get(await storeSignedIn(ctx, profile)))!
    return { _id: user._id, name: user.name, avatarUrl: user.avatarUrl }
  },
})

/** The signed-in user's profile, read fresh from WorkOS; null if it can't be. */
async function fetchProfile(workosId: string): Promise<Profile | null> {
  const response = await fetch(
    `${workosApiUrl()}/user_management/users/${encodeURIComponent(workosId)}`,
    { headers: { Authorization: `Bearer ${process.env.WORKOS_API_KEY}` } }
  ).catch(() => null)
  if (!response?.ok) return null
  const data = (await response.json()) as {
    first_name?: string | null
    last_name?: string | null
    email?: string | null
    profile_picture_url?: string | null
  }
  return {
    firstName: data.first_name,
    lastName: data.last_name,
    email: data.email,
    avatarUrl: data.profile_picture_url,
  }
}

/**
 * `store`, with the name and photo read fresh from WorkOS: someone who signs
 * in to comment has their real name on their comments from the first
 * sign-in, before the user.created webhook arrives. When WorkOS can't be
 * reached, it is `store`.
 */
async function sync(ctx: ActionCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) fail("unauthenticated", "Sign in first")
  const profile = await fetchProfile(identity.subject)
  return ctx.runMutation(internal.users.storeProfile, {
    profile: profile ?? undefined,
  })
}

/** One call for the dashboard: the user's row, up to date. Returns `me`. */
export const storeFresh = action({
  args: {},
  handler: (
    ctx
  ): Promise<{
    _id: Id<"users">
    name: string
    avatarUrl?: string
  }> => sync(ctx),
})

/** The older form of `storeFresh`, called after `store`. */
export const refreshProfile = action({
  args: {},
  handler: async (ctx) => {
    await sync(ctx)
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
