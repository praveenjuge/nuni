import { elementText } from "@nuni/anchor"
import { LIMITS, type Anchor, type TextSuggestion } from "@nuni/shared"

import { h } from "./dom"

/**
 * The text a comment can suggest new words for: the selected words, or the
 * whole text of a small element (a button, a link, a heading) with no other
 * text inside it. Null for areas, form fields and larger blocks.
 */
export function suggestableText(
  anchor: Anchor,
  element: Element
): string | null {
  if (anchor.quote) return anchor.quote.exact
  if (anchor.region || !anchor.text) return null
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)) return null
  // Text cut at the limit can't be replaced as a whole.
  if (anchor.text.length >= LIMITS.anchorTextMaxLength) return null
  for (const child of element.querySelectorAll("*")) {
    if (elementText(child)) return null
  }
  return anchor.text
}

/** The old words struck through and the new ones, under a small label. */
export function renderSuggestion(
  suggestion: TextSuggestion,
  label: string,
  action?: Node | null
): HTMLElement {
  return h(
    "div",
    { class: "suggest" },
    h("div", { class: "suggest-label" }, label, action),
    h("del", {}, suggestion.before),
    h("ins", {}, suggestion.after)
  )
}

/** One line for the panel: old → new. */
export function renderSuggestionLine(suggestion: TextSuggestion): HTMLElement {
  return h(
    "div",
    { class: "item-quote item-suggest" },
    h("del", {}, suggestion.before),
    " → ",
    h("ins", {}, suggestion.after)
  )
}
