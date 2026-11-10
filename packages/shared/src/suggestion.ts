import type { Anchor } from "./types"

/**
 * The words a suggestion on this anchor replaces: the selected words, or
 * the whole text of the element. Empty for an area, which has no text of
 * its own. The widget offers a suggestion for it and the backend accepts
 * one only when its `before` is exactly this.
 */
export function suggestionTarget(
  anchor: Pick<Anchor, "text" | "quote" | "region">
): string {
  if (anchor.quote) return anchor.quote.exact
  return anchor.region ? "" : anchor.text
}
