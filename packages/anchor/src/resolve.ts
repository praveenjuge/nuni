import type { Anchor } from "@nuni/shared"

import { reactComponentName } from "./component"
import { attributeAllowed, type AnchorOptions } from "./options"
import { stableClasses } from "./stable"
import { elementText, textSimilarity } from "./text"

export type Confidence = "exact" | "high" | "low" | "lost"

export interface ResolveResult {
  element: Element | null
  confidence: Confidence
  score: number
}

const THRESHOLD = { exact: 0.9, high: 0.72, low: 0.55 } as const
const AMBIGUITY_MARGIN = 0.03
const MAX_SCAN = 3000

function safeQueryAll(root: ParentNode, selector: string | undefined, limit = 20): Element[] {
  if (!selector) return []
  try {
    return Array.from(root.querySelectorAll(selector)).slice(0, limit)
  } catch {
    return []
  }
}

function safeMatches(el: Element, selector: string | undefined): boolean {
  if (!selector) return false
  try {
    return el.matches(selector)
  } catch {
    return false
  }
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1
  const setA = new Set(a)
  let inter = 0
  for (const x of new Set(b)) if (setA.has(x)) inter++
  return inter / (setA.size + new Set(b).size - inter)
}

function splitTestId(testId: string): [string, string] | null {
  const i = testId.indexOf("=")
  return i > 0 ? [testId.slice(0, i), testId.slice(i + 1)] : null
}

function attrQuery(name: string, value: string) {
  return `[${name}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
}

function normalizeHref(value: string, doc: Document): string {
  try {
    const url = new URL(value, doc.baseURI)
    return url.pathname.replace(/\/$/, "") + url.search
  } catch {
    return value
  }
}

/** Siblings that look like the same kind of item (list rows, cards). */
function peerCount(el: Element): number {
  const parent = el.parentElement
  if (!parent) return 0
  const classes = stableClasses(el).join(" ")
  let count = 0
  for (const child of Array.from(parent.children)) {
    if (child === el || child.tagName !== el.tagName) continue
    if (stableClasses(child).join(" ") === classes) count++
  }
  return count
}

interface Scored {
  el: Element
  score: number
  text: number
  context: number | null
  strong: boolean
}

const IDENTIFYING_ATTRS = new Set([
  "href",
  "name",
  "aria-label",
  "src",
  "for",
  "placeholder",
  "alt",
  "title",
])

function scoreCandidate(
  anchor: Anchor,
  el: Element,
  doc: Document,
  ctx: { pathMatch: Element | null; viewportRatio: number },
  options: AnchorOptions
): Scored {
  let total = 0
  let weights = 0
  const add = (weight: number, value: number) => {
    total += weight * value
    weights += weight
  }

  const tag = el.tagName.toLowerCase()
  add(1, tag === anchor.tag ? 1 : 0)

  let strong = false
  if (anchor.selectors.id) {
    const hit = el.getAttribute("id") === anchor.selectors.id
    strong ||= hit
    add(3, hit ? 1 : 0)
  }
  if (anchor.selectors.testId) {
    const parts = splitTestId(anchor.selectors.testId)
    const hit = Boolean(parts && el.getAttribute(parts[0]) === parts[1])
    strong ||= hit
    add(4, hit ? 1 : 0)
  }
  const cssHit = safeMatches(el, anchor.selectors.css)
  if (anchor.selectors.css) add(1.5, cssHit ? 1 : 0)
  const pathHit = ctx.pathMatch === el
  add(1, pathHit ? 1 : 0)

  if (anchor.classes && anchor.classes.length) {
    add(1.5, jaccard(stableClasses(el), anchor.classes))
  }

  const attrNames = Object.keys(anchor.attrs).filter((n) => attributeAllowed(n, options))
  let identifyingAttrsMatch = false
  if (attrNames.length) {
    let matched = 0
    let identifying = 0
    let identifyingMatched = 0
    for (const name of attrNames) {
      const isIdentifying = IDENTIFYING_ATTRS.has(name)
      if (isIdentifying) identifying++
      const current = el.getAttribute(name)
      if (current == null) continue
      const expected = anchor.attrs[name]!
      const hit =
        name === "href" || name === "src"
          ? normalizeHref(current, doc) === normalizeHref(expected, doc)
          : current === expected
      if (hit) {
        matched++
        if (isIdentifying) identifyingMatched++
      } else {
        matched += textSimilarity(current, expected) * 0.5
      }
    }
    add(2, matched / attrNames.length)
    identifyingAttrsMatch = identifying > 0 && identifyingMatched === identifying
  }

  if (anchor.role) add(0.5, el.getAttribute("role") === anchor.role ? 1 : 0)
  if (anchor.componentName) {
    add(0.5, reactComponentName(el) === anchor.componentName ? 1 : 0)
  }

  const text = elementText(el)
  const textSim = anchor.text ? textSimilarity(text, anchor.text) : text ? 0.3 : 1
  add(anchor.text ? 3 : 1, textSim)

  // Ancestor structure, plus context text from the closest ancestor whose
  // text says more than the element itself (a card title, a row, a form).
  let ancTotal = 0
  let ancWeights = 0
  let context: number | null = null
  let node = el.parentElement
  anchor.ancestors.forEach((expected, i) => {
    const weight = 1 - i * 0.15
    ancWeights += weight
    if (!node) return
    let s = node.tagName.toLowerCase() === expected.tag ? 0.4 : 0
    const nodeId = node.getAttribute("id")
    if (expected.id) s += nodeId === expected.id ? 0.35 : 0
    else s += 0.35 * (nodeId ? 0.5 : 1)
    s += 0.25 * jaccard(stableClasses(node), expected.classes)
    ancTotal += weight * s
    if (context === null && expected.text && expected.text !== anchor.text) {
      context = textSimilarity(elementText(node, 80), expected.text)
    }
    node = node.parentElement
  })
  if (ancWeights) add(1.5, ancTotal / ancWeights)
  if (context !== null) add(2, context)

  const parent = el.parentElement
  const index = parent ? Array.prototype.indexOf.call(parent.children, el) : 0
  add(0.5, Math.max(0, 1 - Math.abs(index - anchor.siblingIndex) / 3))

  // Geometry, trusted less when the viewport width changed.
  const geoWeight = Math.max(0, 1 - Math.abs(ctx.viewportRatio - 1) * 2)
  if (geoWeight > 0 && anchor.rect.w + anchor.rect.h > 0) {
    const r = el.getBoundingClientRect()
    if (r.width + r.height > 0) {
      const view = doc.defaultView
      const cx = r.left + (view?.scrollX ?? 0) + r.width / 2
      const cy = r.top + (view?.scrollY ?? 0) + r.height / 2
      const ax = (anchor.rect.x + anchor.rect.w / 2) * ctx.viewportRatio
      const ay = anchor.rect.y + anchor.rect.h / 2
      const distance = Math.hypot(cx - ax, cy - ay)
      add(1.5 * geoWeight, Math.exp(-distance / 250))
      const sw = Math.min(r.width, anchor.rect.w) / Math.max(r.width, anchor.rect.w, 1)
      const sh = Math.min(r.height, anchor.rect.h) / Math.max(r.height, anchor.rect.h, 1)
      add(0.5 * geoWeight, sw * sh)
    }
  }

  let score = weights ? total / weights : 0

  // Same structural slot and same identifying attributes (href, name...):
  // the element's copy was edited or translated, not swapped.
  const structural = (cssHit || !anchor.selectors.css) && pathHit && identifyingAttrsMatch

  // Text is identity for repeated items (list rows, cards), and a softer
  // signal for one-off elements whose copy may be edited.
  if (anchor.text.length >= 2 && textSim < 0.999) {
    const repeated = peerCount(el) > 0
    const factor = repeated
      ? 0.2 + 0.8 * textSim * textSim
      : 0.7 + 0.3 * textSim
    score *= strong || structural ? Math.max(factor, 0.92) : factor
  }

  return { el, score, text: textSim, context, strong: strong || structural }
}

function collectCandidates(
  anchor: Anchor,
  doc: Document,
  options: AnchorOptions
): { candidates: Set<Element>; pathMatch: Element | null } {
  const candidates = new Set<Element>()
  const ignored = (el: Element) =>
    el === doc.documentElement || (options.isIgnored?.(el) ?? false)
  const add = (el: Element | null | undefined) => {
    if (el && !ignored(el)) candidates.add(el)
  }

  if (anchor.selectors.id) add(doc.getElementById(anchor.selectors.id))
  if (anchor.selectors.testId) {
    const parts = splitTestId(anchor.selectors.testId)
    if (parts) safeQueryAll(doc, attrQuery(parts[0], parts[1])).forEach(add)
  }
  safeQueryAll(doc, anchor.selectors.css).forEach(add)
  const pathMatch = safeQueryAll(doc, anchor.selectors.path, 1)[0] ?? null
  add(pathMatch)

  const needle = anchor.text.slice(0, 24).toLowerCase()
  const sameTag = doc.getElementsByTagName(anchor.tag)
  const scanAll = sameTag.length <= MAX_SCAN
  for (let i = 0; i < sameTag.length && i < MAX_SCAN * 2; i++) {
    const el = sameTag[i]!
    if (scanAll) {
      add(el)
      continue
    }
    const content = el.textContent?.toLowerCase() ?? ""
    if (needle && content.includes(needle)) add(el)
  }

  // Tag changed (e.g. <button> became <a>): look for the same text anywhere.
  if (anchor.text.length >= 3) {
    const exact = anchor.text.toLowerCase()
    const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, 1)
    let count = 0
    for (let n = walker.nextNode(); n && count < MAX_SCAN * 3; n = walker.nextNode()) {
      count++
      const el = n as Element
      if (el.tagName.toLowerCase() === anchor.tag) continue
      const content = el.textContent
      if (!content || content.length > exact.length * 3 + 20) continue
      if (elementText(el).toLowerCase() === exact) add(el)
    }
  }
  return { candidates, pathMatch }
}

/** Find the element an anchor was captured on, in the current document. */
export function resolveAnchor(
  anchor: Anchor,
  doc: Document = document,
  options: AnchorOptions = {}
): ResolveResult {
  if (anchor.tag === "body" || anchor.tag === "html") {
    return { element: doc.body, confidence: "exact", score: 1 }
  }

  const { candidates, pathMatch } = collectCandidates(anchor, doc, options)
  if (!candidates.size) return { element: null, confidence: "lost", score: 0 }

  const view = doc.defaultView
  const viewportRatio =
    anchor.viewport.w && view?.innerWidth ? view.innerWidth / anchor.viewport.w : 1

  const scored: Scored[] = []
  for (const el of candidates) {
    scored.push(scoreCandidate(anchor, el, doc, { pathMatch, viewportRatio }, options))
  }

  // When several candidates share the element's exact text ("Choose plan"
  // on every pricing card), the surrounding context is what identifies it.
  const sameText = scored.filter(
    (s) => s.text >= 0.999 && s.el.tagName.toLowerCase() === anchor.tag
  ).length
  if (sameText > 1) {
    for (const s of scored) {
      if (s.context === null || s.strong) continue
      s.score *= 0.2 + 0.8 * s.context * s.context
    }
  }
  scored.sort((a, b) => b.score - a.score)

  // Prefer the innermost of nested candidates with equal text (a <span> in a
  // <button> vs the button itself are both plausible; keep the better tag).
  const best = scored[0]!
  const second = scored.find((s) => s.el !== best.el && !best.el.contains(s.el) && !s.el.contains(best.el))

  if (best.score < THRESHOLD.low) {
    return { element: null, confidence: "lost", score: best.score }
  }

  let confidence: Confidence =
    best.score >= THRESHOLD.exact && best.text >= 0.999
      ? "exact"
      : best.score >= THRESHOLD.high
        ? "high"
        : "low"
  if (second && best.score - second.score < AMBIGUITY_MARGIN) confidence = "low"

  return { element: best.el, confidence, score: best.score }
}
