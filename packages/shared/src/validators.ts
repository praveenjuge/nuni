import { v } from "convex/values"

/**
 * The Convex validators for everything the widget sends and the backend
 * stores. The types in `types.ts` are inferred from these, so the two can't
 * drift. Published widgets send these shapes: never rename a field or make
 * an optional one required.
 */

const rectValidator = v.object({
  x: v.number(),
  y: v.number(),
  w: v.number(),
  h: v.number(),
})

const anchorFields = {
  v: v.literal(1),
  selectors: v.object({
    id: v.optional(v.string()),
    testId: v.optional(v.string()),
    css: v.optional(v.string()),
    path: v.string(),
  }),
  tag: v.string(),
  /** Stable, human-authored classes on the element itself. */
  classes: v.optional(v.array(v.string())),
  role: v.optional(v.string()),
  text: v.string(),
  attrs: v.record(v.string(), v.string()),
  ancestors: v.array(
    v.object({
      tag: v.string(),
      id: v.optional(v.string()),
      classes: v.array(v.string()),
      text: v.optional(v.string()),
    })
  ),
  siblingIndex: v.number(),
  siblingCount: v.number(),
  componentName: v.optional(v.string()),
  /** Element box in document coordinates at capture time. */
  rect: rectValidator,
  /** Click point inside the element, 0..1 on each axis. */
  offset: v.object({ x: v.number(), y: v.number() }),
  viewport: v.object({
    w: v.number(),
    h: v.number(),
    dpr: v.number(),
    scrollX: v.number(),
    scrollY: v.number(),
  }),
  docSize: v.object({ w: v.number(), h: v.number() }),
}

/** Everything needed to find a commented element again. Version 1. */
export const anchorValidator = v.object({
  ...anchorFields,
  /**
   * A text comment: the selected words inside the element, found again by
   * their exact words and the text around them (like the W3C
   * TextQuoteSelector). Whitespace is collapsed.
   */
  quote: v.optional(
    v.object({ exact: v.string(), prefix: v.string(), suffix: v.string() })
  ),
  /** An area comment: a box inside the element, 0..1 of its size. */
  region: v.optional(rectValidator),
  /**
   * Shadow hosts and same-origin iframes on the way to the element,
   * outermost first, each captured like any element in its own scope. The
   * selectors above are relative to the innermost one.
   */
  scope: v.optional(
    v.array(
      v.object({
        kind: v.union(v.literal("shadow"), v.literal("frame")),
        host: v.object(anchorFields),
      })
    )
  ),
})

/** Where a comment was left. `path` is the key comments are matched by. */
export const pageValidator = v.object({
  origin: v.string(),
  path: v.string(),
  search: v.string(),
  hash: v.string(),
  title: v.string(),
  url: v.string(),
})

export const viewportValidator = v.object({
  w: v.number(),
  h: v.number(),
  dpr: v.number(),
})

/**
 * Extra context captured with a comment. Only the project owner can read it,
 * since comments themselves are readable by anyone with the project ID.
 */
export const contextValidator = v.object({
  console: v.optional(
    v.array(
      v.object({
        level: v.union(v.literal("error"), v.literal("warn")),
        message: v.string(),
        at: v.number(),
      })
    )
  ),
  /** Failed requests. `url` is origin + path only; `status` 0 is a network error. */
  network: v.optional(
    v.array(
      v.object({
        method: v.string(),
        url: v.string(),
        status: v.number(),
        at: v.number(),
      })
    )
  ),
  /** Trimmed outerHTML with form values removed, and a fixed set of styles. */
  dom: v.optional(
    v.object({ html: v.string(), styles: v.record(v.string(), v.string()) })
  ),
})

export const statusValidator = v.union(v.literal("open"), v.literal("resolved"))

export const emailFrequencyValidator = v.union(
  v.literal("off"),
  v.literal("hourly"),
  v.literal("daily"),
  v.literal("weekly")
)

/** Why a comment was resolved without a change: its element is gone. */
export const resolutionValidator = v.literal("outdated")

/** A text change the commenter suggests: the words on the page, and theirs. */
export const suggestionValidator = v.object({
  before: v.string(),
  after: v.string(),
})

/**
 * Who is writing from the widget: the browser's key, and the commenter's
 * session token when they signed in.
 */
export const widgetAuthorArgs = {
  authorSecret: v.string(),
  commenterToken: v.optional(v.string()),
}
