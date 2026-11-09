import { AuthKit, type AuthFunctions } from "@convex-dev/workos-authkit"

import { components, internal } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { upsertUser, userByWorkosId, type Profile } from "./accounts"
import { setOwner } from "./ownership"

const authFunctions: AuthFunctions = internal.auth

export const authKit = new AuthKit<DataModel>(components.workOSAuthKit, {
  authFunctions,
})

/**
 * The user deleted in WorkOS: their sessions go, and their projects are
 * released so they can be claimed again instead of being stranded.
 */
async function deleteUser(ctx: MutationCtx, workosId: string) {
  const user = await userByWorkosId(ctx, workosId)
  if (!user) return
  for (const table of ["widgetSessions", "commenterSessions"] as const) {
    const sessions = await ctx.db
      .query(table)
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()
    for (const session of sessions) await ctx.db.delete(session._id)
  }
  const owned = await ctx.db
    .query("projects")
    .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
    .collect()
  for (const project of owned) await setOwner(ctx, project, null)
  await ctx.db.delete(user._id)
}

function profileOf(user: {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  profilePictureUrl?: string | null
}): Profile {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    avatarUrl: user.profilePictureUrl,
  }
}

export const { authKitEvent } = authKit.events({
  "user.created": async (ctx, event) => {
    await upsertUser(ctx, event.data.id, profileOf(event.data))
  },
  "user.updated": async (ctx, event) => {
    if (!(await userByWorkosId(ctx, event.data.id))) return
    await upsertUser(ctx, event.data.id, profileOf(event.data))
  },
  "user.deleted": async (ctx, event) => {
    await deleteUser(ctx, event.data.id)
  },
})
