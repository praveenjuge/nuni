import { attributeAllowed, type AnchorOptions } from "./options"
import { isStableId, stableClasses, TEST_ID_ATTRIBUTES } from "./stable"

export function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value)
  }
  return value.replace(/([^\w-])/g, "\\$1").replace(/^(\d)/, "\\3$1 ")
}

function attrSelector(name: string, value: string): string {
  return `[${name}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
}

export function testIdOf(
  el: Element,
  options: AnchorOptions
): { attr: string; value: string } | null {
  for (const attr of TEST_ID_ATTRIBUTES) {
    if (!attributeAllowed(attr, options)) continue
    const value = el.getAttribute(attr)
    if (value && value.length <= 100) return { attr, value }
  }
  return null
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
  const parent = el.parentElement
  if (!parent) return 1
  let count = 0
  for (const child of Array.from(parent.children)) {
    if (child.tagName === el.tagName) count++
  }
  return count
}

function queryCount(root: ParentNode, selector: string): number {
  try {
    return root.querySelectorAll(selector).length
  } catch {
    return Infinity
  }
}

function isUniqueId(doc: Document, id: string): boolean {
  return queryCount(doc, `#${cssEscape(id)}`) === 1
}

/**
 * Structural path: nth-of-type chain from the nearest ancestor with a
 * stable unique id (or from <html>). Always resolvable when the DOM is
 * unchanged; the last-resort selector.
 */
export function buildPath(el: Element): string {
  const doc = el.ownerDocument
  const parts: string[] = []
  let node: Element | null = el
  while (node && node !== doc.documentElement) {
    const id = stableIdOf(node)
    if (id && node !== el && isUniqueId(doc, id)) {
      parts.unshift(`#${cssEscape(id)}`)
      return parts.join(" > ")
    }
    const tag = tagOf(node)
    parts.unshift(
      countOfType(node) > 1 ? `${tag}:nth-of-type(${nthOfType(node)})` : tag
    )
    node = node.parentElement
  }
  return parts.length ? `html > ${parts.join(" > ")}` : "html"
}

function describeSegment(el: Element, options: AnchorOptions): string {
  const tag = tagOf(el)
  const testId = testIdOf(el, options)
  if (testId) return tag + attrSelector(testId.attr, testId.value)

  let segment = tag
  for (const cls of stableClasses(el).slice(0, 2)) segment += `.${cssEscape(cls)}`

  for (const name of ["name", "type", "role"]) {
    const value = el.getAttribute(name)
    if (value && value.length <= 40 && attributeAllowed(name, options)) {
      if (name === "type" && tag !== "input" && tag !== "button") continue
      segment += attrSelector(name, value)
    }
  }
  const label = el.getAttribute("aria-label")
  if (label && label.length <= 60) segment += attrSelector("aria-label", label)
  return segment
}

/**
 * Shortest readable selector that is unique in the document, built from
 * stable ids, test ids, semantic classes and attributes. Returns undefined
 * when no unique selector is found within a few levels.
 */
export function buildCssSelector(
  el: Element,
  options: AnchorOptions = {}
): string | undefined {
  const doc = el.ownerDocument
  const id = stableIdOf(el)
  if (id && isUniqueId(doc, id)) return `#${cssEscape(id)}`

  const segments: string[] = []
  let node: Element | null = el
  for (let depth = 0; node && depth < 6; depth++) {
    if (node === doc.documentElement || node === doc.body) {
      segments.unshift(tagOf(node))
      break
    }
    const nodeId = stableIdOf(node)
    if (depth > 0 && nodeId && isUniqueId(doc, nodeId)) {
      segments.unshift(`#${cssEscape(nodeId)}`)
      const selector = segments.join(" > ")
      if (queryCount(doc, selector) === 1) return selector
      break
    }

    segments.unshift(describeSegment(node, options))
    let selector = segments.join(" > ")
    if (queryCount(doc, selector) === 1) return selector

    // Disambiguate this level among siblings.
    const parent = node.parentElement
    if (parent && queryCount(parent, `:scope > ${segments[0]}`) > 1) {
      segments[0] = `${segments[0]}:nth-of-type(${nthOfType(node)})`
      selector = segments.join(" > ")
      if (queryCount(doc, selector) === 1) return selector
    }
    node = node.parentElement
  }
  const selector = segments.join(" > ")
  return queryCount(doc, selector) === 1 ? selector : undefined
}
