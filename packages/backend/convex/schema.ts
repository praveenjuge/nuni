import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

import {
  anchorValidator,
  pageValidator,
  statusValidator,
  viewportValidator,
} from "./validators"

export default defineSchema({
  users: defineTable({
    workosId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  }).index("by_workosId", ["workosId"]),

  projects: defineTable({
    publicId: v.string(),
    name: v.string(),
    ownerId: v.optional(v.id("users")),
    claimedAt: v.optional(v.number()),
    origins: v.array(v.string()),
    commentCount: v.number(),
    openCount: v.number(),
    lastActivityAt: v.number(),
  })
    .index("by_publicId", ["publicId"])
    .index("by_owner", ["ownerId", "lastActivityAt"]),

  comments: defineTable({
    projectId: v.id("projects"),
    status: statusValidator,
    body: v.string(),
    authorName: v.string(),
    authorKeyHash: v.string(),
    page: pageValidator,
    anchor: anchorValidator,
    viewport: viewportValidator,
    userAgent: v.string(),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.id("users")),
  })
    .index("by_project_path", ["projectId", "page.path", "createdAt"])
    .index("by_project_status", ["projectId", "status", "createdAt"]),

  widgetSessions: defineTable({
    tokenHash: v.string(),
    userId: v.id("users"),
    projectId: v.id("projects"),
    origin: v.string(),
    userAgent: v.optional(v.string()),
    expiresAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_project", ["projectId"]),

  claims: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    origin: v.optional(v.string()),
  }).index("by_project", ["projectId"]),
})
