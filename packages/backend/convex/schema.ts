import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

import {
  anchorValidator,
  contextValidator,
  pageValidator,
  statusValidator,
  suggestionValidator,
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
    /** Set while the owner's delete runs; the project takes no new comments. */
    deletingAt: v.optional(v.number()),
  })
    .index("by_publicId", ["publicId"])
    .index("by_owner", ["ownerId", "lastActivityAt"]),

  comments: defineTable({
    projectId: v.id("projects"),
    status: statusValidator,
    body: v.string(),
    authorName: v.string(),
    authorKeyHash: v.string(),
    /** New words for the commented text; `before` is the text as it was. */
    suggestion: v.optional(suggestionValidator),
    page: pageValidator,
    anchor: anchorValidator,
    viewport: viewportValidator,
    userAgent: v.string(),
    /** Owner-only: console, network and DOM details from the commenter. */
    context: v.optional(contextValidator),
    /** Owner-only: an image of the element, uploaded right after posting. */
    screenshotId: v.optional(v.id("_storage")),
    /** Body plus author name, for dashboard search. */
    searchText: v.optional(v.string()),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.id("users")),
    /** Replies in the thread, kept in sync by replies.ts. */
    replyCount: v.optional(v.number()),
    /** Reactions on the comment and its replies, for the per-thread cap. */
    reactionCount: v.optional(v.number()),
  })
    .index("by_project_path", ["projectId", "page.path", "createdAt"])
    .index("by_project_path_status", [
      "projectId",
      "page.path",
      "status",
      "createdAt",
    ])
    .index("by_project_status", ["projectId", "status", "createdAt"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["projectId", "status"],
    }),

  /** Replies in a comment's thread. Public, like the comment. */
  replies: defineTable({
    commentId: v.id("comments"),
    projectId: v.id("projects"),
    body: v.string(),
    authorName: v.string(),
    authorKeyHash: v.string(),
    /** Set when the project owner wrote it (shown with an Owner badge). */
    ownerId: v.optional(v.id("users")),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
  })
    .index("by_comment", ["commentId", "createdAt"])
    .index("by_project", ["projectId"]),

  /** One emoji from one author on a comment or one of its replies. */
  reactions: defineTable({
    commentId: v.id("comments"),
    projectId: v.id("projects"),
    /** The comment id, or a reply id in its thread. */
    targetId: v.string(),
    emoji: v.string(),
    authorKeyHash: v.string(),
  })
    .index("by_comment", ["commentId"])
    .index("by_target_author_emoji", ["targetId", "authorKeyHash", "emoji"])
    .index("by_project", ["projectId"]),

  /** Open comment count per page, so the widget can list other pages. */
  pageStats: defineTable({
    projectId: v.id("projects"),
    path: v.string(),
    openCount: v.number(),
  })
    .index("by_project_path", ["projectId", "path"])
    .index("by_project_open", ["projectId", "openCount"]),

  widgetSessions: defineTable({
    tokenHash: v.string(),
    userId: v.id("users"),
    projectId: v.id("projects"),
    /** "cli" for `nuni login` (CLI and MCP), otherwise the widget. */
    kind: v.optional(v.union(v.literal("widget"), v.literal("cli"))),
    origin: v.string(),
    userAgent: v.optional(v.string()),
    expiresAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"])
    .index("by_expires", ["expiresAt"]),

  /**
   * A `nuni login` waiting for the owner to approve it in the dashboard. The
   * CLI holds the device secret (only its hash is stored) and polls with it;
   * the person compares the user code. Deleted once the CLI collects its
   * session, or when it expires.
   */
  cliLogins: defineTable({
    secretHash: v.string(),
    userCode: v.string(),
    publicId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied")
    ),
    userId: v.optional(v.id("users")),
    /** What the CLI says it is, shown on the approval page. */
    client: v.string(),
    expiresAt: v.number(),
  })
    .index("by_secretHash", ["secretHash"])
    .index("by_userCode", ["userCode"])
    .index("by_publicId", ["publicId"])
    .index("by_expires", ["expiresAt"]),

  /**
   * A link the owner made to hand the project to someone else. Only the
   * token's hash is stored; the link is shown once.
   */
  transfers: defineTable({
    projectId: v.id("projects"),
    fromUserId: v.id("users"),
    tokenHash: v.string(),
    expiresAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_project", ["projectId"])
    .index("by_expires", ["expiresAt"]),

  claims: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    origin: v.optional(v.string()),
  }).index("by_project", ["projectId"]),
})
