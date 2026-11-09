import { MASK_SELECTOR } from "@nuni/shared"

import { isShadowRoot, scopeRootOf, type ScopeRoot } from "./scope"
import { isStableId, stableClasses, TEST_ID_ATTRIBUTES } from "./stable"

export function attrSelector(name: string, value: string): string {
  return `[${name}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
}

/** Every element matching `selector` in `root`; none when it is invalid. */
export function queryAll(
  root: ParentNode,
  selector: string | undefined
): ArrayLike<Element> {
  if (!selector) return []
  try {
    return root.querySelectorAll(selector)
  } catch {
    return []
  }
}

export interface TestId {
  attr: string
  value: string
}

export function testIdOf(el: Element): TestId | null {
  for (const attr of TEST_ID_ATTRIBUTES) {
    const value = el.getAttribute(attr)
    if (value && value.length <= 100) return { attr, value }
  }
  return null
}

/** A test id as stored in `anchor.selectors.testId`: `attr=value`. */
export function formatTestId({ attr, value }: TestId): string {
  return `${attr}=${value}`
}

export function parseTestId(stored: string): TestId | null {
  const i = stored.indexOf("=")
  return i > 0 ? { attr: stored.slice(0, i), value: stored.slice(i + 1) } : null
}

export function stableIdOf(el: Element): string | null {
  const id = el.getAttribute("id")
  return id && isStableId(id) ? id : null
}

function tagOf(el: Element): string {
  return el.tagName.toLowerCase()
}

export function nthOfType(el: Element): number {
  let index = 1
  let sibling = el.previousElementSibling
  while (sibling) {
    if (sibling.tagName === el.tagName) index++
    sibling = sibling.previousElementSibling
  }
  return index
}

function countOfType(el: Element): number {
  // parentNode, so top-level elements of a shadow root count their siblings.
  const parent = el.parentNode as ParentNode | null
  if (!parent) return 1
  let count = 0
  for (const child of Array.from(parent.children)) {
    if (child.tagName === el.tagName) count++
  }
  return count
}

function queryCount(root: ParentNode, selector: string): number {
  return queryAll(root, selector).length
}

function isUniqueId(root: ScopeRoot, id: string): boolean {
  return queryCount(root, `#${CSS.escape(id)}`) === 1
}

/**
 * Structural path: nth-of-type chain from the nearest ancestor with a
 * stable unique id (or from <html>). Always resolvable when the DOM is
 * unchanged; the last-resort selector. Inside a shadow root it starts at
 * the root's top-level element instead of <html>.
 */
export function buildPath(el: Element): string {
  const root = scopeRootOf(el)
  const doc = el.ownerDocument
  const parts: string[] = []
  let node: Element | null = el
  while (node && node !== doc.documentElement) {
    const id = stableIdOf(node)
    if (id && node !== el && isUniqueId(root, id)) {
      parts.unshift(`#${CSS.escape(id)}`)
      return parts.join(" > ")
    }
    const tag = tagOf(node)
    parts.unshift(
      countOfType(node) > 1 ? `${tag}:nth-of-type(${nthOfType(node)})` : tag
    )
    node = node.parentElement
  }
  if (isShadowRoot(root)) return parts.join(" > ")
  return parts.length ? `html > ${parts.join(" > ")}` : "html"
}

/**
 * The element a path points to in a scope. Shadow paths are matched from
 * the root's top-level elements, like document paths are from <html>.
 */
export function queryPath(root: ScopeRoot, path: string): Element | null {
  const matches = Array.from(queryAll(root, path)).slice(0, 50)
  if (!isShadowRoot(root) || path.startsWith("#")) return matches[0] ?? null
  const depth = path.split(" > ").length
  return (
    matches.find((el) => {
      let node: Element | null = el
      for (let i = 1; i < depth && node; i++) node = node.parentElement
      return node?.parentNode === root
    }) ?? null
  )
}

function describeSegment(el: Element): string {
  const tag = tagOf(el)
  const testId = testIdOf(el)
  if (testId) return tag + attrSelector(testId.attr, testId.value)

  let segment = tag
  for (const cls of stableClasses(el).slice(0, 2))
    segment += `.${CSS.escape(cls)}`

  for (const name of ["name", "type", "role"]) {
    const value = el.getAttribute(name)
    if (value && value.length <= 40) {
      if (name === "type" && tag !== "input" && tag !== "button") continue
      segment += attrSelector(name, value)
    }
  }
  // Selectors are public; a label in a masked area can be as private as its text.
  const label = el.getAttribute("aria-label")
  if (label && label.length <= 60 && !el.closest(MASK_SELECTOR))
    segment += attrSelector("aria-label", label)
  return segment
}

/**
 * Shortest readable selector that is unique in the document, built from
 * stable ids, test ids, semantic classes and attributes. Returns undefined
 * when no unique selector is found within a few levels.
 */
export function buildCssSelector(el: Element): string | undefined {
  const doc = el.ownerDocument
  const root = scopeRootOf(el)
  const id = stableIdOf(el)
  if (id && isUniqueId(root, id)) return `#${CSS.escape(id)}`

  const segments: string[] = []
  let node: Element | null = el
  for (let depth = 0; node && depth < 6; depth++) {
    if (node === doc.documentElement || node === doc.body) {
      segments.unshift(tagOf(node))
      break
    }
    const nodeId = stableIdOf(node)
    if (depth > 0 && nodeId && isUniqueId(root, nodeId)) {
      segments.unshift(`#${CSS.escape(nodeId)}`)
      const selector = segments.join(" > ")
      if (queryCount(root, selector) === 1) return selector
      break
    }

    segments.unshift(describeSegment(node))
    let selector = segments.join(" > ")
    if (queryCount(root, selector) === 1) return selector

    const parent = node.parentElement
    if (parent && queryCount(parent, `:scope > ${segments[0]}`) > 1) {
      segments[0] = `${segments[0]}:nth-of-type(${nthOfType(node)})`
      selector = segments.join(" > ")
      if (queryCount(root, selector) === 1) return selector
    }
    node = node.parentElement
  }
  const selector = segments.join(" > ")
  return queryCount(root, selector) === 1 ? selector : undefined
}
