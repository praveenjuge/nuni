import { v } from "convex/values"

export const rectValidator = v.object({
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
  rect: rectValidator,
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

export const anchorValidator = v.object({
  ...anchorFields,
  /** Shadow hosts and iframes on the way to the element, outermost first. */
  scope: v.optional(
    v.array(
      v.object({
        kind: v.union(v.literal("shadow"), v.literal("frame")),
        host: v.object(anchorFields),
      })
    )
  ),
})

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
  dom: v.optional(
    v.object({ html: v.string(), styles: v.record(v.string(), v.string()) })
  ),
})

export const statusValidator = v.union(v.literal("open"), v.literal("resolved"))
