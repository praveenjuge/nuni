import { LIMITS, type Anchor, type AnchorAncestor } from "@nuni/shared"

import { reactComponentName } from "./component"
import { clamp01, documentRect, documentSize, viewportInfo } from "./geometry"
import { attributeAllowed, type AnchorOptions } from "./options"
import {
  buildCssSelector,
  buildPath,
  stableIdOf,
  testIdOf,
} from "./selector"
import { CAPTURED_ATTRIBUTES, stableClasses } from "./stable"
import { elementText } from "./text"

function capturedAttributes(el: Element, options: AnchorOptions) {
  const attrs: Record<string, string> = {}
  for (const name of CAPTURED_ATTRIBUTES) {
    if (!attributeAllowed(name, options)) continue
    if (name === "value" && !(el instanceof HTMLButtonElement || el.getAttribute("type") === "submit")) {
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
  while (node && out.length < 5 && node !== node.ownerDocument.documentElement) {
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
 */
export function captureAnchor(
  el: Element,
  point?: { x: number; y: number },
  options: AnchorOptions = {}
): Anchor {
  const doc = el.ownerDocument
  const rect = documentRect(el)
  const viewport = viewportInfo(doc)
  const client = el.getBoundingClientRect()

  const offset = point
    ? {
        x: clamp01(client.width ? (point.x - client.left) / client.width : 0.5),
        y: clamp01(client.height ? (point.y - client.top) / client.height : 0.5),
      }
    : { x: 0.5, y: 0.5 }

  const id = stableIdOf(el)
  const testId = testIdOf(el, options)
  const css = buildCssSelector(el, options)
  const role = el.getAttribute("role") ?? undefined

  const parent = el.parentElement
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
