const EVENT = "nuni:locationchange"
const METHODS = ["pushState", "replaceState"] as const
let listeners = 0
let restore: (() => void) | null = null

/**
 * The history API has no event of its own: wrap pushState and replaceState
 * while anyone listens, and put them back after (unless another script
 * wrapped them again since).
 */
function patchHistory() {
  const originals = METHODS.map((method) => {
    const original = history[method]
    const wrapped = function (
      this: History,
      ...args: Parameters<History["pushState"]>
    ) {
      const result = original.apply(this, args)
      window.dispatchEvent(new Event(EVENT))
      return result
    }
    history[method] = wrapped
    return { method, original, wrapped }
  })
  return () => {
    for (const { method, original, wrapped } of originals) {
      if (history[method] === wrapped) history[method] = original
    }
  }
}

/** Notify on SPA navigations (history API, back/forward, hash changes). */
export function onLocationChange(cb: () => void): () => void {
  if (listeners++ === 0) restore = patchHistory()
  let last = location.href
  const check = () => {
    if (location.href === last) return
    last = location.href
    cb()
  }
  const nav = (window as unknown as { navigation?: EventTarget }).navigation
  window.addEventListener(EVENT, check)
  window.addEventListener("popstate", check)
  window.addEventListener("hashchange", check)
  nav?.addEventListener("navigatesuccess", check)
  return () => {
    window.removeEventListener(EVENT, check)
    window.removeEventListener("popstate", check)
    window.removeEventListener("hashchange", check)
    nav?.removeEventListener("navigatesuccess", check)
    if (--listeners === 0) {
      restore?.()
      restore = null
    }
  }
}
