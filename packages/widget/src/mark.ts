/**
 * Marks Nuni's own screenshot requests (fonts and images it inlines from
 * the page's origins), so the network collector can skip them without
 * muting the page. `Symbol.for` is shared by the widget and the separately
 * loaded screenshot script.
 */
export const CAPTURE_MARK = Symbol.for("nuni.capture")

/**
 * Nuni's own requests, which are not the page's problem: marked ones, and
 * any to Nuni's backend `origins` (the Convex client makes some of its own).
 */
export function ownTraffic(
  origins: string[]
): (url: string, init?: RequestInit) => boolean {
  const own = new Set(
    origins.flatMap((url) => {
      try {
        return [new URL(url).origin]
      } catch {
        return []
      }
    })
  )
  return (url, init) => {
    if (init && (init as Record<symbol, unknown>)[CAPTURE_MARK]) return true
    try {
      return own.has(new URL(url, location.href).origin)
    } catch {
      return false
    }
  }
}
