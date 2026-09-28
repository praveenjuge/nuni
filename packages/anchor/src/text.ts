const SKIP_TEXT_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "SVG",
])

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/** Visible-ish text of an element, whitespace-normalized and truncated. */
export function elementText(el: Element, max = 120): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return normalizeText(
      el.placeholder || el.getAttribute("aria-label") || ""
    ).slice(0, max)
  }
  let out = ""
  const walk = (node: Node) => {
    if (out.length > max * 2) return
    if (node.nodeType === 3) {
      out += node.nodeValue ?? ""
      return
    }
    if (node.nodeType !== 1) return
    const tag = (node as Element).tagName.toUpperCase()
    if (SKIP_TEXT_TAGS.has(tag)) return
    if (tag === "IMG") {
      out += " " + ((node as Element).getAttribute("alt") ?? "") + " "
      return
    }
    for (const child of Array.from(node.childNodes)) walk(child)
    if (tag === "BR" || tag === "P" || tag === "DIV" || tag === "LI") out += " "
  }
  walk(el)
  return normalizeText(out).slice(0, max)
}

function bigrams(value: string): Map<string, number> {
  const s = value.toLowerCase()
  const map = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const gram = s.slice(i, i + 2)
    map.set(gram, (map.get(gram) ?? 0) + 1)
  }
  return map
}

/** Sørensen-Dice coefficient on character bigrams, 0..1. */
export function textSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const na = a.toLowerCase()
  const nb = b.toLowerCase()
  if (na === nb) return 1
  if (na.length < 2 || nb.length < 2) return 0
  const ga = bigrams(na)
  const gb = bigrams(nb)
  let overlap = 0
  for (const [gram, count] of ga) {
    const other = gb.get(gram)
    if (other) overlap += Math.min(count, other)
  }
  return (2 * overlap) / (na.length - 1 + (nb.length - 1))
}
