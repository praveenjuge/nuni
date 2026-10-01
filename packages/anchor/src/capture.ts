import {
  LIMITS,
  MASK_SELECTOR,
  type Anchor,
  type AnchorAncestor,
} from "@nuni/shared"

import { reactComponentName } from "./component"
import { clamp01, documentRect, documentSize, viewportInfo } from "./geometry"
import { attributeAllowed, type AnchorOptions } from "./options"
import { captureQuote, quoteContainer } from "./quote"
import { scopeChain } from "./scope"
import { buildCssSelector, buildPath, stableIdOf, testIdOf } from "./selector"
import { CAPTURED_ATTRIBUTES, stableClasses } from "./stable"
import { elementText } from "./text"

function capturedAttributes(el: Element, options: AnchorOptions) {
  const attrs: Record<string, string> = {}
  // Labels and titles in a masked area can be as private as its text.
  if (el.closest(MASK_SELECTOR)) return attrs
  for (const name of CAPTURED_ATTRIBUTES) {
    if (!attributeAllowed(name, options)) continue
    if (
      name === "value" &&
      !(el.tagName === "BUTTON" || el.getAttribute("type") === "submit")
    ) {
      continue
    }
    const value = el.getAttribute(name)
    if (value) attrs[name] = value.slice(0, 200)
  }
  return attrs
}

function ancestorsOf(el: Element): AnchorAncestor[] {
  const out: AnchorAncestor[] = []
  let node = el.parentElement
  while (
    node &&
    out.length < 5 &&
    node !== node.ownerDocument.documentElement
  ) {
    const id = stableIdOf(node)
    const entry: AnchorAncestor = {
      tag: node.tagName.toLowerCase(),
      classes: stableClasses(node).slice(0, 3),
    }
    if (id) entry.id = id
    // Short context text (e.g. the card title) for the closest ancestors,
    // used to tell identical-looking siblings apart.
    if (out.length < 3 && node !== node.ownerDocument.body) {
      const text = elementText(node, 80)
      if (text) entry.text = text
    }
    out.push(entry)
    node = node.parentElement
  }
  return out
}

/**
 * Record everything needed to find `el` again later.
 * `point` is the click position in viewport (client) coordinates.
 *
 * An element inside open shadow roots or same-origin iframes also records
 * each host and iframe on the way (`scope`), captured the same way, so it
 * can be found again level by level.
 */
export function captureAnchor(
  el: Element,
  point?: { x: number; y: number },
  options: AnchorOptions = {}
): Anchor {
  const anchor = captureLocal(el, point, options)
  const top =
    options.document ??
    (typeof document === "undefined" ? el.ownerDocument : document)
  const chain = scopeChain(el, top)
  if (chain.length) {
    anchor.scope = chain.map(({ kind, host }) => ({
      kind,
      host: captureLocal(host, undefined, options),
    }))
  }
  return anchor
}

/** The anchor of `el` within its own scope (document or shadow root). */
function captureLocal(
  el: Element,
  point: { x: number; y: number } | undefined,
  options: AnchorOptions
): Anchor {
  const doc = el.ownerDocument
  const rect = documentRect(el)
  const viewport = viewportInfo(doc)
  const client = el.getBoundingClientRect()

  const offset = point
    ? {
        x: clamp01(client.width ? (point.x - client.left) / client.width : 0.5),
        y: clamp01(
          client.height ? (point.y - client.top) / client.height : 0.5
        ),
      }
    : { x: 0.5, y: 0.5 }

  const id = stableIdOf(el)
  const testId = testIdOf(el, options)
  const css = buildCssSelector(el, options)
  const role = el.getAttribute("role") ?? undefined

  // parentNode, so top-level elements of a shadow root have siblings too.
  const parent = el.parentNode as ParentNode | null
  const siblings = parent ? Array.from(parent.children) : [el]

  const anchor: Anchor = {
    v: 1,
    selectors: {
      path: buildPath(el),
      ...(id ? { id } : {}),
      ...(testId ? { testId: `${testId.attr}=${testId.value}` } : {}),
      ...(css ? { css } : {}),
    },
    tag: el.tagName.toLowerCase(),
    classes: stableClasses(el),
    text: elementText(el, LIMITS.anchorTextMaxLength),
    attrs: capturedAttributes(el, options),
    ancestors: ancestorsOf(el),
    siblingIndex: siblings.indexOf(el),
    siblingCount: siblings.length,
    rect,
    offset,
    viewport,
    docSize: documentSize(doc),
  }
  if (role) anchor.role = role
  const componentName = reactComponentName(el)
  if (componentName) anchor.componentName = componentName
  return anchor
}

/**
 * A text comment: the anchor of the paragraph (or heading, cell...) holding
 * the selected text, plus the words themselves and the text around them.
 * Null when the selection holds no text.
 */
export function captureSelection(
  range: Range,
  options: AnchorOptions = {}
): { element: Element; anchor: Anchor } | null {
  const element = quoteContainer(range)
  if (!element) return null
  const quote = captureQuote(range, element)
  if (!quote) return null
  const rects = range.getClientRects()
  const first = rects[0] ?? range.getBoundingClientRect()
  const anchor = captureAnchor(
    element,
    { x: first.left, y: first.top + first.height / 2 },
    options
  )
  anchor.quote = quote
  return { element, anchor }
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The element an area comment belongs to: the smallest one that covers the
 * whole box (in viewport coordinates).
 */
export function areaContainer(
  doc: Document,
  box: Box,
  isIgnored: (el: Element) => boolean = () => false
): Element {
  const right = box.left + box.width
  const bottom = box.top + box.height
  const corners: [number, number][] = [
    [box.left + 1, box.top + 1],
    [right - 1, box.top + 1],
    [box.left + 1, bottom - 1],
    [right - 1, bottom - 1],
  ]
  const ignored = (el: Element) =>
    isIgnored(el) || el.closest("[data-nuni]") !== null
  let common: Element | null = null
  for (const [x, y] of corners) {
    const hit = doc.elementsFromPoint(x, y).find((el) => !ignored(el))
    if (hit) common = common ? commonAncestor(common, hit) : hit
  }
  let el = common ?? doc.body
  while (el.parentElement && el !== doc.body) {
    const r = el.getBoundingClientRect()
    if (
      r.left <= box.left + 1 &&
      r.top <= box.top + 1 &&
      r.right >= right - 1 &&
      r.bottom >= bottom - 1
    ) {
      break
    }
    el = el.parentElement
  }
  return el
}

function commonAncestor(a: Element, b: Element): Element {
  const seen = new Set<Element>()
  for (let n: Element | null = a; n; n = n.parentElement) seen.add(n)
  for (let n: Element | null = b; n; n = n.parentElement) {
    if (seen.has(n)) return n
  }
  return a.ownerDocument.body
}

/**
 * An area comment: the covering element's anchor plus the box as fractions
 * of that element's size, so it scales with the layout.
 */
export function captureArea(
  el: Element,
  box: Box,
  options: AnchorOptions = {}
): Anchor {
  const anchor = captureAnchor(
    el,
    { x: box.left + box.width, y: box.top },
    options
  )
  const r = el.getBoundingClientRect()
  const x = r.width ? clamp01((box.left - r.left) / r.width) : 0
  const y = r.height ? clamp01((box.top - r.top) / r.height) : 0
  anchor.region = {
    x,
    y,
    w: r.width ? Math.min(1 - x, box.width / r.width) : 1,
    h: r.height ? Math.min(1 - y, box.height / r.height) : 1,
  }
  return anchor
}
