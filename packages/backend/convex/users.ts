import { mutation, query } from "./_generated/server"
import { authKit } from "./auth"
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

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx)
    if (!user) return null
    return { _id: user._id, name: user.name, avatarUrl: user.avatarUrl }
  },
})
