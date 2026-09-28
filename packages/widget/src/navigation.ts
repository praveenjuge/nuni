const EVENT = "nuni:locationchange"
let patched = false

/** Notify on SPA navigations (history API, back/forward, hash changes). */
export function onLocationChange(cb: () => void): () => void {
  if (!patched) {
    patched = true
    for (const method of ["pushState", "replaceState"] as const) {
      const original = history[method]
      history[method] = function (
        this: History,
        ...args: Parameters<History["pushState"]>
      ) {
        const result = original.apply(this, args)
        window.dispatchEvent(new Event(EVENT))
        return result
      }
    }
  }
  let last = location.href
  const check = () => {
    if (location.href === last) return
    last = location.href
    cb()
  }
  window.addEventListener(EVENT, check)
  window.addEventListener("popstate", check)
  window.addEventListener("hashchange", check)
  const nav = (window as unknown as { navigation?: EventTarget }).navigation
  const onNavigate = () => setTimeout(check, 0)
  nav?.addEventListener("navigatesuccess", onNavigate)
  return () => {
    window.removeEventListener(EVENT, check)
    window.removeEventListener("popstate", check)
    window.removeEventListener("hashchange", check)
    nav?.removeEventListener("navigatesuccess", onNavigate)
  }
}
