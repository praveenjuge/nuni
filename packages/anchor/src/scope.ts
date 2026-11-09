import { LIMITS } from "@nuni/shared"

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
  /** The shadow host or <iframe>, in the scope around it. */
  host: Element
  /** Its shadow root or document: the scope one level further in. */
  root: ScopeRoot
}

/**
 * Shadow hosts and iframes between the page's document and the element,
 * outermost first. Every walk out of shadow roots and iframes goes through
 * this, so they all stop at the same depth.
 */
export function scopeChain(el: Element, top: Document = document): ScopeStep[] {
  const chain: ScopeStep[] = []
  let node = el
  for (let depth = 0; depth < LIMITS.anchorScopeMaxDepth; depth++) {
    const root = node.getRootNode()
    if (isShadowRoot(root)) {
      chain.unshift({ kind: "shadow", host: root.host, root })
      node = root.host
      continue
    }
    if (node.ownerDocument === top) break
    const frame = frameElementOf(node.ownerDocument)
    if (!frame) break
    chain.unshift({ kind: "frame", host: frame, root: node.ownerDocument })
    node = frame
  }
  return chain
}

/**
 * Same-origin iframe documents inside `doc`, nested ones too, as deep as an
 * anchor's scope can go.
 */
export function frameDocuments(doc: Document, depth = 1): Document[] {
  if (depth > LIMITS.anchorScopeMaxDepth) return []
  const out: Document[] = []
  for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
    const inner = frameDocument(frame)
    if (inner?.documentElement) {
      out.push(inner, ...frameDocuments(inner, depth + 1))
    }
  }
  return out
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
export function viewportRect(
  el: Element,
  top: Document = document
): ViewportRect {
  const r = el.getBoundingClientRect()
  let left = r.left
  let topPx = r.top
  let clipped = false
  const frames = scopeChain(el, top).filter((s) => s.kind === "frame")
  for (const { host: frame, root } of frames.reverse()) {
    const view = scopeDocument(root).defaultView
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
  }
  return { left, top: topPx, width: r.width, height: r.height, clipped }
}
