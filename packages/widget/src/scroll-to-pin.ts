import { scopeChain, viewportRect } from "@nuni/anchor"

type Point = () => { x: number; y: number }

/** Reveal the pin itself, including scroll containers and same-origin frames. */
export function scrollToPin(element: Element, point: Point) {
  // Reveal the element first; its center may be far from the commented spot.
  element.scrollIntoView({
    block: "center",
    inline: "center",
    behavior: "instant",
  })
  // Innermost scope first: its scroll boxes, its frame's window, then the
  // scope around it, out to the page.
  let node = element
  for (const step of [...scopeChain(element).reverse(), null]) {
    for (let box = node.parentElement; box; box = box.parentElement) {
      centerIn(box, point)
    }
    if (step?.kind !== "shadow") {
      const view = node.ownerDocument.defaultView
      const frame = step?.host ?? null
      if (view) {
        const pin = point()
        const rect = frame ? viewportRect(frame, document) : { left: 0, top: 0 }
        view.scrollBy({
          left:
            pin.x - rect.left - (frame?.clientLeft ?? 0) - view.innerWidth / 2,
          top:
            pin.y - rect.top - (frame?.clientTop ?? 0) - view.innerHeight / 2,
          behavior: "instant",
        })
      }
    }
    if (!step) return
    node = step.host
  }
}

/** Scroll a scroll box so the pin sits in its middle. */
function centerIn(box: Element, point: Point) {
  if (box === box.ownerDocument.scrollingElement) return
  const style = box.ownerDocument.defaultView?.getComputedStyle(box)
  const scrollX = style && /auto|scroll|hidden/.test(style.overflowX)
  const scrollY = style && /auto|scroll|hidden/.test(style.overflowY)
  if (!scrollX && !scrollY) return
  const rect = viewportRect(box, document)
  const pin = point()
  box.scrollBy({
    left: scrollX
      ? pin.x - rect.left - box.clientLeft - box.clientWidth / 2
      : 0,
    top: scrollY ? pin.y - rect.top - box.clientTop - box.clientHeight / 2 : 0,
    behavior: "instant",
  })
}
