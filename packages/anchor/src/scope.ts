/**
 * Elements inside open shadow roots and same-origin iframes. A "scope" is
 * the root an element lives in: the page's document, a shadow root, or an
 * iframe's document. Selectors are always built and matched inside one.
 */

export type ScopeRoot = Document | ShadowRoot

export function isShadowRoot(node: Node | null): node is ShadowRoot {
  return Boolean(node && node.nodeType === 11 && "host" in node)
}

/** The shadow root or document the element lives in. */
export function scopeRootOf(el: Element): ScopeRoot {
  const root = el.getRootNode()
  return isShadowRoot(root) ? root : el.ownerDocument
}

export function scopeDocument(root: ScopeRoot): Document {
  return isShadowRoot(root) ? root.ownerDocument : root
}

/** The <iframe> showing this document, when the parent is same-origin. */
export function frameElementOf(doc: Document): Element | null {
  try {
    return doc.defaultView?.frameElement ?? null
  } catch {
    return null
  }
}

/** A same-origin iframe's document, or null (cross-origin, not loaded). */
export function frameDocument(el: Element): Document | null {
  if (el.tagName !== "IFRAME" && el.tagName !== "FRAME") return null
  try {
    return (el as HTMLIFrameElement).contentDocument
  } catch {
    return null
  }
}

export interface ScopeStep {
  kind: "shadow" | "frame"
  host: Element
}

/**
 * Shadow hosts and iframes between the page's document and the element,
 * outermost first.
 */
export function scopeChain(el: Element, top: Document): ScopeStep[] {
  const chain: ScopeStep[] = []
  let node = el
  for (let depth = 0; depth < 8; depth++) {
    const root = node.getRootNode()
    if (isShadowRoot(root)) {
      chain.unshift({ kind: "shadow", host: root.host })
      node = root.host
      continue
    }
    if (node.ownerDocument === top) break
    const frame = frameElementOf(node.ownerDocument)
    if (!frame) break
    chain.unshift({ kind: "frame", host: frame })
    node = frame
  }
  return chain
}

export interface ViewportRect {
  left: number
  top: number
  width: number
  height: number
  /** Scrolled out of an iframe it is inside, so not on screen. */
  clipped: boolean
}

/**
 * The element's box in the page's viewport: getBoundingClientRect plus the
 * offset of every iframe it is inside.
 */
export function viewportRect(el: Element, top?: Document): ViewportRect {
  const r = el.getBoundingClientRect()
  let left = r.left
  let topPx = r.top
  let clipped = false
  let doc = el.ownerDocument
  for (let depth = 0; depth < 8 && doc !== top; depth++) {
    const frame = frameElementOf(doc)
    if (!frame) break
    const view = doc.defaultView
    if (
      view &&
      (left + r.width < 0 ||
        topPx + r.height < 0 ||
        left > view.innerWidth ||
        topPx > view.innerHeight)
    ) {
      clipped = true
    }
    const f = frame.getBoundingClientRect()
    left += f.left + frame.clientLeft
    topPx += f.top + frame.clientTop
    doc = frame.ownerDocument
  }
  return { left, top: topPx, width: r.width, height: r.height, clipped }
}
