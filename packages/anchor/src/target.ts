const INTERACTIVE =
  "a[href], button, label, summary, select, textarea, input, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [role=option]"
const INLINE = new Set([
  "SPAN",
  "STRONG",
  "EM",
  "B",
  "I",
  "SMALL",
  "MARK",
  "SUB",
  "SUP",
  "ABBR",
  "CODE",
  "KBD",
  "TIME",
  "U",
  "S",
])

/**
 * Choose the element a click should attach to: the interactive control or
 * the meaningful element, not an icon path or a styling <span>.
 */
export function pickTarget(el: Element): Element {
  let target = el
  const svg = target.closest("svg")
  if (svg) target = svg.parentElement ?? svg
  const interactive = target.closest(INTERACTIVE)
  if (interactive) return interactive

  while (
    INLINE.has(target.tagName) &&
    target.parentElement &&
    target.parentElement !== target.ownerDocument.body &&
    !target.id
  ) {
    target = target.parentElement
  }
  return target
}
