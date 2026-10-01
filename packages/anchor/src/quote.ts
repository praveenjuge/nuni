import {
  LIMITS,
  MASK_ATTRIBUTE,
  MASK_SELECTOR,
  type Anchor,
  type AnchorQuote,
} from "@nuni/shared"

import { textSimilarity } from "./text"

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"])

/** Elements whose edges read as a space between words. */
const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
])

/** Formatting inside a paragraph: a quote climbs out of these. */
const INLINE_TAGS = new Set([
  "A",
  "ABBR",
  "B",
  "BDI",
  "BDO",
  "CITE",
  "CODE",
  "DATA",
  "DEL",
  "DFN",
  "EM",
  "I",
  "INS",
  "KBD",
  "LABEL",
  "MARK",
  "Q",
  "S",
  "SAMP",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TIME",
  "U",
  "VAR",
])

/** Longest text searched for a quote inside one element. */
const MAX_TEXT = 20_000
/** Longest text searched for an edited quote, word by word. */
const MAX_FUZZY_TEXT = 6_000
const FUZZY_MIN = 0.75
const WORD = /[\p{L}\p{N}]/u

/**
 * An element's text with whitespace collapsed (as it reads on screen), and
 * for every character the text node and offset it came from, so a span of
 * the text can be turned back into a DOM Range.
 */
export interface TextMap {
  text: string
  nodes: Text[]
  /** Per character: index into `nodes`. */
  node: number[]
  /** Per character: offset inside that node. */
  offset: number[]
}

export function textMap(el: Element): TextMap {
  const map: TextMap = { text: "", nodes: [], node: [], offset: [] }
  if (el.closest(MASK_SELECTOR)) return map
  const chars: string[] = []
  let space = true
  const push = (c: string, node: number, offset: number) => {
    chars.push(c)
    map.node.push(node)
    map.offset.push(offset)
  }
  const gap = () => {
    // A word break at a block edge, placed after the last character.
    if (space || !map.nodes.length) return
    const last = map.nodes.length - 1
    push(" ", last, map.nodes[last]!.length)
    space = true
  }
  const walk = (node: Node) => {
    if (chars.length >= MAX_TEXT) return
    if (node.nodeType === 3) {
      const value = node.nodeValue ?? ""
      if (!value) return
      const index = map.nodes.push(node as Text) - 1
      for (let i = 0; i < value.length && chars.length < MAX_TEXT; i++) {
        const c = value[i]!
        if (c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f") {
          if (!space) push(" ", index, i)
          space = true
        } else {
          push(c, index, i)
          space = false
        }
      }
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    const tag = el.tagName.toUpperCase()
    if (SKIP_TAGS.has(tag)) return
    if (el.hasAttribute(MASK_ATTRIBUTE) || el.hasAttribute("data-nuni")) return
    const block = BLOCK_TAGS.has(tag)
    if (block) gap()
    for (const child of Array.from(el.childNodes)) walk(child)
    if (block) gap()
  }
  walk(el)
  while (chars.length && chars[chars.length - 1] === " ") {
    chars.pop()
    map.node.pop()
    map.offset.pop()
  }
  map.text = chars.join("")
  return map
}

/**
 * Where a DOM boundary point falls in the element's text: the index of the
 * first character at or after it.
 */
export function textOffset(
  map: TextMap,
  container: Node,
  offset: number
): number {
  if (!map.text.length) return 0
  const doc = container.ownerDocument ?? (container as Document)
  const point = doc.createRange()
  point.setStart(container, offset)
  point.collapse(true)
  let lo = 0
  let hi = map.text.length
  try {
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const node = map.nodes[map.node[mid]!]!
      // -1: the character is before the point.
      if (point.comparePoint(node, map.offset[mid]!) < 0) lo = mid + 1
      else hi = mid
    }
  } catch {
    return -1
  }
  return lo
}

/** A Range over characters [start, end) of the element's text. */
export function rangeFor(map: TextMap, start: number, end: number): Range {
  const first = map.nodes[map.node[start]!]!
  const last = map.nodes[map.node[end - 1]!]!
  const range = first.ownerDocument.createRange()
  range.setStart(first, map.offset[start]!)
  range.setEnd(last, Math.min(last.length, map.offset[end - 1]! + 1))
  return range
}

/**
 * The element a text selection is anchored to: the closest element holding
 * all of it, out of inline formatting (a <strong>, a link) so it is the
 * paragraph or heading, which is easier to find again.
 */
export function quoteContainer(range: Range): Element | null {
  let node: Node | null = range.commonAncestorContainer
  if (node.nodeType !== 1) node = node.parentNode
  if (!node || node.nodeType !== 1) return null
  let el = node as Element
  const body = el.ownerDocument.body
  while (
    INLINE_TAGS.has(el.tagName.toUpperCase()) &&
    el.parentElement &&
    el.parentElement !== body
  ) {
    el = el.parentElement
  }
  return el
}

/** The quoted words of a selection inside `el`, with context around them. */
export function captureQuote(range: Range, el: Element): AnchorQuote | null {
  const map = textMap(el)
  let start = textOffset(map, range.startContainer, range.startOffset)
  let end = textOffset(map, range.endContainer, range.endOffset)
  if (start < 0 || end < 0) return null
  const { text } = map
  while (start < end && text[start] === " ") start++
  while (end > start && text[end - 1] === " ") end--
  if (end <= start) return null
  const exact = text.slice(start, Math.min(end, start + LIMITS.quoteMaxLength))
  const after = start + exact.length
  return {
    exact,
    prefix: text.slice(Math.max(0, start - LIMITS.quoteContextLength), start),
    suffix: text.slice(after, after + LIMITS.quoteContextLength),
  }
}

export interface QuoteMatch {
  range: Range
  /** False when the words were edited and this is the closest match. */
  exact: boolean
}

/**
 * Find a quote again inside `el`. When it is not there (the sentence moved
 * to the next paragraph), look in the parent and grandparent, but only take
 * a match there whose surrounding text still agrees.
 */
export function findQuote(el: Element, quote: AnchorQuote): QuoteMatch | null {
  const own = findIn(el, quote, 0)
  if (own) return own
  let node = el.parentElement
  const body = el.ownerDocument.body
  for (let i = 0; node && node !== body && i < 2; i++) {
    const hit = findIn(node, quote, 0.6)
    if (hit) return hit
    node = node.parentElement
  }
  return null
}

function affixSimilarity(actual: string, expected: string): number {
  if (!expected) return actual ? 0.8 : 1
  return textSimilarity(actual, expected)
}

/** How well the text around a match agrees with the quote's context. */
function contextScore(
  text: string,
  start: number,
  end: number,
  quote: AnchorQuote
): number {
  const before = text.slice(Math.max(0, start - quote.prefix.length), start)
  const after = text.slice(end, end + quote.suffix.length)
  return (
    (affixSimilarity(before.trimStart(), quote.prefix.trimStart()) +
      affixSimilarity(after.trimEnd(), quote.suffix.trimEnd())) /
    2
  )
}

function findIn(
  el: Element,
  quote: AnchorQuote,
  minContext: number
): QuoteMatch | null {
  const { exact } = quote
  if (!exact) return null
  const map = textMap(el)
  const { text } = map
  if (!text) return null

  // Every copy of the words; the context around them picks one.
  let best = -1
  let bestScore = -1
  for (let i = text.indexOf(exact); i >= 0; i = text.indexOf(exact, i + 1)) {
    const score = contextScore(text, i, i + exact.length, quote)
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  if (best >= 0 && bestScore >= minContext) {
    return { range: rangeFor(map, best, best + exact.length), exact: true }
  }

  // The words were edited: the closest span of about the same length.
  if (exact.length < 8 || text.length > MAX_FUZZY_TEXT) return null
  const fuzzy = closestSpan(text, quote)
  if (!fuzzy) return null
  const context = contextScore(text, fuzzy.start, fuzzy.end, quote)
  if (fuzzy.score < FUZZY_MIN || context < Math.max(minContext, 0.3)) {
    return null
  }
  return { range: rangeFor(map, fuzzy.start, fuzzy.end), exact: false }
}

/** Word-aligned spans of `text` scored by similarity to the quote. */
function closestSpan(
  text: string,
  quote: AnchorQuote
): { start: number; end: number; score: number } | null {
  // Words start and end at spaces, and also where letters meet
  // punctuation ("cleanup." can end at "cleanup").
  const word = (c: string | undefined) => c !== undefined && WORD.test(c)
  const starts: number[] = []
  const ends: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === " ") continue
    const prev = text[i - 1]
    const next = text[i + 1]
    if (prev === undefined || prev === " " || (word(c) && !word(prev))) {
      starts.push(i)
    }
    if (next === undefined || next === " " || (word(c) && !word(next))) {
      ends.push(i + 1)
    }
  }
  const length = quote.exact.length
  let best: { start: number; end: number; score: number } | null = null
  let e = 0
  for (const start of starts) {
    // Ends around start + length, from 70% to 130% of it.
    while (e < ends.length && ends[e]! <= start) e++
    for (let j = e; j < ends.length; j++) {
      const span = ends[j]! - start
      if (span < length * 0.7) continue
      if (span > length * 1.3) break
      const score = textSimilarity(text.slice(start, ends[j]), quote.exact)
      if (!best || score > best.score) best = { start, end: ends[j]!, score }
    }
  }
  return best
}

/** Shorthand for the widget: the quote's range for a resolved anchor. */
export function resolveQuote(
  anchor: Anchor,
  element: Element
): QuoteMatch | null {
  return anchor.quote ? findQuote(element, anchor.quote) : null
}
