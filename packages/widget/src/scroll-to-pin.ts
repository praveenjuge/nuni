import { frameElementOf, isShadowRoot, viewportRect } from "@nuni/anchor"

/** Reveal the pin itself, including scroll containers and same-origin frames. */
export function scrollToPin(
  element: Element,
  point: () => { x: number; y: number }
) {
  // Reveal the element first; its center may be far from the commented spot.
  element.scrollIntoView({
    block: "center",
    inline: "center",
    behavior: "instant",
  })
  let node: Element | null = element
  while (node) {
    const parent: Element | null = node.parentElement
    if (parent) {
      const view: Window | null = parent.ownerDocument.defaultView
      const style: CSSStyleDeclaration | undefined =
        view?.getComputedStyle(parent)
      const scrollX = style && /auto|scroll|hidden/.test(style.overflowX)
      const scrollY = style && /auto|scroll|hidden/.test(style.overflowY)
      if (
        parent !== parent.ownerDocument.scrollingElement &&
        (scrollX || scrollY)
      ) {
        const rect = viewportRect(parent, document)
        const pin = point()
        parent.scrollBy({
          left: scrollX
            ? pin.x - rect.left - parent.clientLeft - parent.clientWidth / 2
            : 0,
          top: scrollY
            ? pin.y - rect.top - parent.clientTop - parent.clientHeight / 2
            : 0,
          behavior: "instant",
        })
      }
      node = parent
      continue
    }
    const root = node.getRootNode()
    if (isShadowRoot(root)) {
      node = root.host
      continue
    }
    const doc = node.ownerDocument
    const view = doc.defaultView
    const frame = frameElementOf(doc)
    if (view) {
      const pin = point()
      const rect = frame ? viewportRect(frame, document) : { left: 0, top: 0 }
      view.scrollBy({
        left:
          pin.x - rect.left - (frame?.clientLeft ?? 0) - view.innerWidth / 2,
        top: pin.y - rect.top - (frame?.clientTop ?? 0) - view.innerHeight / 2,
        behavior: "instant",
      })
    }
    node = frame
  }
}
