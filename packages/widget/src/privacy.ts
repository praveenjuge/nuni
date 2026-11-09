import { MASK_ATTRIBUTE, MASK_SELECTOR } from "@nuni/shared"

/**
 * What a visitor typed, chose or the site masked never leaves the page:
 * not in a comment's markup snippet, not in its screenshot, and keys
 * pressed or text selected in a field are not Nuni's.
 */

const FIELDS = "input, textarea, select"
const ATTR_MAX = 200
const TEXT_MAX = 200
/** Input types that show what was typed (checkboxes and buttons don't). */
const TYPED_INPUTS = new Set([
  "text",
  "file",
  "email",
  "tel",
  "url",
  "search",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
])

/** Text being typed: a form field or an editor. */
export function isEditable(target: EventTarget | null | undefined): boolean {
  // nodeType, not instanceof: iframe elements come from another realm.
  if (!target || (target as Node).nodeType !== 1) return false
  const el = target as HTMLElement
  return el.isContentEditable || el.closest(FIELDS) !== null
}

export function isMasked(el: Element): boolean {
  return el.closest(MASK_SELECTOR) !== null
}

/** Fields whose text is painted over in a screenshot. */
export function showsTypedText(el: Element): boolean {
  return (
    // The browser-normalized type: unknown or misspelled types act as text.
    (el instanceof HTMLInputElement && TYPED_INPUTS.has(el.type)) ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  )
}

/** The elements of `frame` a screenshot paints over, or checks for that. */
export function privateElements(frame: Element): Element[] {
  return [
    frame,
    ...Array.from(frame.querySelectorAll(`${FIELDS}, ${MASK_SELECTOR}`)),
  ]
}

/** Replace an element's contents with a short note. */
function redact(el: Element, note: string) {
  el.replaceChildren(el.ownerDocument.createComment(` ${note} `))
}

/**
 * Remove from a copy of the page's markup what should never leave the page
 * (form values, option lists and masked areas), and trim the rest.
 */
export function scrub(root: Element) {
  const walker = root.ownerDocument.createTreeWalker(root, 1 | 4)
  const drop: Node[] = []
  for (let node: Node | null = root; node; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      const text = node.textContent ?? ""
      if (text.length > TEXT_MAX)
        node.textContent = `${text.slice(0, TEXT_MAX)}…`
      continue
    }
    const el = node as Element
    const tag = el.tagName
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
      drop.push(el)
      continue
    }
    if (el.hasAttribute(MASK_ATTRIBUTE)) {
      for (const attr of Array.from(el.attributes)) {
        if (
          attr.name !== "id" &&
          attr.name !== "class" &&
          attr.name !== MASK_ATTRIBUTE
        )
          el.removeAttribute(attr.name)
      }
      redact(el, "masked")
      continue
    }
    // Every input's value: hidden ones often carry tokens.
    if (tag === "INPUT" || tag === "TEXTAREA") {
      el.removeAttribute("value")
      if (tag === "TEXTAREA") el.textContent = ""
    }
    // Options can be the visitor's own data (saved addresses, accounts).
    if (tag === "SELECT" || tag === "DATALIST") {
      const count = el.getElementsByTagName("option").length
      redact(el, `${count} options`)
    }
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.length > ATTR_MAX)
        el.setAttribute(attr.name, `${attr.value.slice(0, ATTR_MAX)}…`)
    }
  }
  for (const node of drop) node.parentNode?.removeChild(node)
}
