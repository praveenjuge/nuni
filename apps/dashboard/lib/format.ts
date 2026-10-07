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

/** "1 comment", "3 comments". */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
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
export { commentUrl as jumpUrl } from "@nuni/shared"

/** The message a Convex error carries, for showing to the person. */
export function errorMessage(error: unknown): string {
  const data = (error as { data?: { message?: string } })?.data
  return (
    data?.message ??
    (error instanceof Error ? error.message : "Please try again.")
  )
}

/** "in 6 days", "in 3 hours": time left until `ts`. */
export function timeLeft(ts: number, now = Date.now()): string {
  const h = Math.max(0, Math.round((ts - now) / 3_600_000))
  if (h < 1) return "in less than an hour"
  if (h < 48) return `in ${h} hour${h === 1 ? "" : "s"}`
  return `in ${Math.round(h / 24)} days`
}

/** A short "Chrome on macOS" from a user agent string. */
export function describeAgent(ua: string | undefined): string {
  if (!ua) return "Unknown device"
  if (ua.startsWith("nuni-cli") || /node|bun/i.test(ua)) return ua.slice(0, 60)
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser"
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : ""
  return os ? `${browser} on ${os}` : browser
}
