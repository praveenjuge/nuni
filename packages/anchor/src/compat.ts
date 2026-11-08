/**
 * The call shapes packages/widget still uses: options that every capture
 * took (`ignoreAttributePrefixes`, `document`), and `resolveAnchor`'s
 * positional document and cache. Each forwards to the per-operation API.
 * Delete this file, and export the real functions from index.ts, once the
 * widget calls the new shapes.
 */
import type { Anchor } from "@nuni/shared"

import * as capture from "./capture"
import * as resolve from "./resolve"

type Ignored = (el: Element) => boolean

/** Accepted and ignored: both were no-ops for the widget. */
interface CaptureOptions {
  ignoreAttributePrefixes?: string[]
  document?: Document
}

export function captureAnchor(
  el: Element,
  point?: { x: number; y: number },
  _options?: CaptureOptions
): Anchor {
  return capture.captureAnchor(el, point)
}

export function captureArea(
  el: Element,
  box: capture.Box,
  _options?: CaptureOptions
): Anchor {
  return capture.captureArea(el, box)
}

export function captureSelection(range: Range, _options?: CaptureOptions) {
  return capture.captureSelection(range)
}

export function areaContainer(
  doc: Document,
  box: capture.Box,
  options: Ignored | { isIgnored?: Ignored } = {}
): Element {
  return capture.areaContainer(
    doc,
    box,
    typeof options === "function" ? { isIgnored: options } : options
  )
}

export function resolveAnchor(
  anchor: Anchor,
  options?: resolve.ResolveOptions | Document,
  legacy?: { isIgnored?: Ignored; document?: Document },
  cache?: resolve.ResolveCache
): resolve.ResolveResult {
  if (options && "nodeType" in options) {
    return resolve.resolveAnchor(anchor, {
      isIgnored: legacy?.isIgnored,
      cache,
    })
  }
  return resolve.resolveAnchor(anchor, options)
}
