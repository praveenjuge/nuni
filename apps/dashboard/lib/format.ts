export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

export function timeUntil(ts: number, now = Date.now()): string {
  // Floor-based buckets: never overstate the time a session has left.
  const s = Math.max(0, (ts - now) / 1000)
  if (s < 60) return "in a minute"
  const m = Math.floor(s / 60)
  if (m < 60) return `in ${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `in ${h}h`
  const d = Math.floor(h / 24)
  return `in ${d}d`
}

export function hostOf(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length > 1)
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  return (parts[0] ?? "?").slice(0, 2).toUpperCase()
}

/** URL that opens the page with the comment focused by the widget. */
export function jumpUrl(
  page: { origin: string; path: string; search: string },
  id: string
): string {
  const [pathname, hashRoute] = page.path.split("#")
  const url = new URL(pathname ?? "/", page.origin)
  const params = new URLSearchParams(page.search)
  params.set("nuni", id)
  url.search = params.toString()
  if (hashRoute) url.hash = hashRoute
  return url.toString()
}
