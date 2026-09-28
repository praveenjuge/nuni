import { AuthKit, type AuthFunctions } from "@convex-dev/workos-authkit"

import { components, internal } from "./_generated/api"
import { deleteUserData } from "./users"
import type { DataModel } from "./_generated/dataModel"

const authFunctions: AuthFunctions = internal.auth

export const authKit = new AuthKit<DataModel>(components.workOSAuthKit, {
  authFunctions,
})

function displayName(data: {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
}): string {
  const full = [data.firstName, data.lastName].filter(Boolean).join(" ").trim()
  return full || data.email?.split("@")[0] || "Owner"
}

export const { authKitEvent } = authKit.events({
  "user.created": async (ctx, event) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_workosId", (q) => q.eq("workosId", event.data.id))
      .unique()
    const fields = {
      name: displayName(event.data),
      email: event.data.email ?? undefined,
      avatarUrl: event.data.profilePictureUrl ?? undefined,
    }
    if (existing) await ctx.db.patch(existing._id, fields)
    else await ctx.db.insert("users", { workosId: event.data.id, ...fields })
  },
  "user.updated": async (ctx, event) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_workosId", (q) => q.eq("workosId", event.data.id))
      .unique()
    if (!user) return
    await ctx.db.patch(user._id, {
      name: displayName(event.data),
      email: event.data.email ?? undefined,
      avatarUrl: event.data.profilePictureUrl ?? undefined,
    })
  },
  "user.deleted": async (ctx, event) => {
    await deleteUserData(ctx, event.data.id)
  },
})
