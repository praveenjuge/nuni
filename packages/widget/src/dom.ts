type Child = Node | string | null | undefined | false
type Attrs = Record<
  string,
  string | number | boolean | EventListener | null | undefined
>

/** Tiny element factory. Strings become text nodes (never HTML). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value)
    } else if (key === "class") {
      el.className = String(value)
    } else if (value === true) {
      el.setAttribute(key, "")
    } else {
      el.setAttribute(key, String(value))
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue
    el.append(
      typeof child === "string" ? document.createTextNode(child) : child
    )
  }
  return el
}

/** Renders one of the constant SVG strings in icons.ts (never user input). */
export function icon(svg: string): HTMLSpanElement {
  const span = document.createElement("span")
  span.className = "icon"
  span.setAttribute("aria-hidden", "true")
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml")
  span.append(document.importNode(parsed.documentElement, true))
  return span
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const hr = Math.round(m / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.round(hr / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters =
    parts.length > 1
      ? parts[0]![0]! + parts[parts.length - 1]![0]!
      : (parts[0] ?? "?").slice(0, 2)
  return letters.toUpperCase()
}

/** Stable pleasant color per author name. */
export function colorFor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return `oklch(0.62 0.17 ${hash % 360})`
}
