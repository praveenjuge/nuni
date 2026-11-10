import { v } from "convex/values"

import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server"
import { upsertUser, userByWorkosId, type Profile } from "./accounts"
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

export const stored = internalQuery({
  args: { workosId: v.string() },
  handler: async (ctx, { workosId }) => {
    const user = await userByWorkosId(ctx, workosId)
    return user
      ? { _id: user._id, name: user.name, avatarUrl: user.avatarUrl }
      : null
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
 * The dashboard calls this once per page load: the signed-in user's row.
 * The first time, before the user.created webhook has arrived, the name and
 * photo are read fresh from WorkOS, so someone who signs in to comment has
 * their real name on their comments right away. After that the stored row is
 * returned as it is: the webhooks keep it current, no WorkOS call slows the
 * page, and a reload can't replace the real name with the token's. When WorkOS can't be
 * reached, the sign-in token's name is used.
 */
export const storeFresh = action({
  args: {},
  handler: async (
    ctx
  ): Promise<{ _id: Id<"users">; name: string; avatarUrl?: string }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) fail("unauthenticated", "Sign in first")
    const stored = await ctx.runQuery(internal.users.stored, {
      workosId: identity.subject,
    })
    if (stored) return stored
    const profile = await fetchProfile(identity.subject)
    return ctx.runMutation(internal.users.storeProfile, {
      profile: profile ?? undefined,
    })
  },
})
