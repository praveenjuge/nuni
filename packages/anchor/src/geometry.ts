import type { Rect } from "@nuni/shared"

export function documentRect(el: Element): Rect {
  const r = el.getBoundingClientRect()
  const view = el.ownerDocument.defaultView
  const sx = view?.scrollX ?? 0
  const sy = view?.scrollY ?? 0
  return { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height }
}

export function viewportInfo(doc: Document) {
  const view = doc.defaultView
  return {
    w: view?.innerWidth ?? 0,
    h: view?.innerHeight ?? 0,
    dpr: view?.devicePixelRatio ?? 1,
    scrollX: view?.scrollX ?? 0,
    scrollY: view?.scrollY ?? 0,
  }
}

export function documentSize(doc: Document) {
  const el = doc.documentElement
  return { w: el.scrollWidth, h: el.scrollHeight }
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

/** True when the element currently takes up space and is not hidden. */
export function isRendered(el: Element): boolean {
  if (!el.isConnected) return false
  const view = el.ownerDocument.defaultView
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    // display: contents or not laid out
    return false
  }
  const style = view?.getComputedStyle(el)
  if (style && (style.visibility === "hidden" || style.display === "none")) {
    return false
  }
  return true
}
