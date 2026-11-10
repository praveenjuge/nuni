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
  // Dark enough for white initials on every hue (at least 4.9:1).
  return `oklch(0.5 0.17 ${hash % 360})`
}

/** Copy text, falling back to execCommand where the async clipboard is off (plain http previews). */
export async function copyText(text: string): Promise<boolean> {
  const copied = await navigator.clipboard
    ?.writeText(text)
    .then(() => true)
    .catch(() => false)
  if (copied) return true
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0"
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    area.remove()
  }
}

/** Any CSS color as RGB, using the browser's own parser. */
export function parseColor(color: string): [number, number, number] | null {
  const probe = document.createElement("span")
  probe.style.color = color
  if (!probe.style.color) return null
  probe.style.display = "none"
  document.documentElement.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()
  if (/^rgba?\(/.test(computed)) {
    const parts = computed.match(/[\d.]+/g)?.map(Number)
    if (parts && parts.length >= 3) return [parts[0]!, parts[1]!, parts[2]!]
  }
  // Newer color spaces (oklch, lab) stay as written: paint one pixel.
  try {
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return [r!, g!, b!]
  } catch {
    return null
  }
}

/** Black or white text, whichever reads better on the color (WCAG). */
export function readableOn([r, g, b]: [number, number, number]): string {
  const channel = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  // Contrast with white is 1.05 / (l + 0.05); with black, (l + 0.05) / 0.05.
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? "#ffffff" : "#111111"
}

/** Phones: cards open as bottom sheets and the panel gives way to them. */
export const MOBILE_MAX_WIDTH = 640

export function isMobile(): boolean {
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches
}

/** Run when the browser is idle, or after `timeout` ms at the latest. */
export function whenIdle(fn: () => void, timeout: number) {
  const idle = (
    window as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    }
  ).requestIdleCallback
  if (idle) idle(fn, { timeout })
  else setTimeout(fn, 0)
}

/**
 * Keep the mouseup and click that end a drag from reaching the page or a
 * button: the browser sends them with the same press, in this task. No
 * event says that no click is coming, so the guard ends with the task.
 */
export function swallowClick(target: EventTarget) {
  const stop = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
  }
  for (const type of ["mouseup", "click"]) {
    target.addEventListener(type, stop, true)
    setTimeout(() => target.removeEventListener(type, stop, true))
  }
}

/** A text box that grows with its text, up to the max height in the styles. */
export function autoGrow(field: HTMLTextAreaElement, extra = 0) {
  field.style.height = "auto"
  field.style.height = `${field.scrollHeight + extra}px`
}

/** The rectangles of a range that have a size (lines of text). */
export function lineRects(range: Range): DOMRect[] {
  return Array.from(range.getClientRects()).filter(
    (r) => r.width > 0 && r.height > 0
  )
}

/** Place a fixed box: `left`, `top`, `width` and `height` in px. */
export function placeBox(
  el: HTMLElement,
  box: { left: number; top: number; width: number; height: number }
) {
  Object.assign(el.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  })
}
