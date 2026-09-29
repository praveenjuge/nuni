import {
  LIMITS,
  type ConsoleEntry,
  type DomContext,
  type NetworkEntry,
} from "@nuni/shared"

export interface CaptureOptions {
  console: boolean
  network: boolean
}

export interface Collectors {
  console(): ConsoleEntry[]
  network(): NetworkEntry[]
  /** Run `fn` without recording its own console output or requests. */
  quiet<T>(fn: () => Promise<T>): Promise<T>
  stop(): void
}

const MESSAGE_MAX = LIMITS.contextMessageMaxLength

function describeValue(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) {
    const frame = value.stack
      ?.split("\n")
      .find((line) => line.trim().startsWith("at "))
    return `${value.name}: ${value.message}${frame ? ` (${frame.trim()})` : ""}`
  }
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function clip(text: string): string {
  return text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX - 1)}…` : text
}

/** Origin + path only: query strings and hashes often carry tokens. */
export function safeUrl(input: string): string {
  try {
    const url = new URL(input, location.href)
    return clip(`${url.origin}${url.pathname}`)
  } catch {
    return clip(input.split(/[?#]/)[0] ?? "")
  }
}

class Ring<T> {
  items: T[] = []
  push(item: T) {
    this.items.push(item)
    if (this.items.length > LIMITS.contextEntryMax) this.items.shift()
  }
}

/**
 * Keep the latest console errors and failed requests, so a comment can carry
 * what went wrong on the page. Installed once per mount, removed on destroy.
 * `ignore` skips Nuni's own traffic.
 */
export function startCollectors(
  options: CaptureOptions,
  ignore: (url: string) => boolean
): Collectors {
  const logs = new Ring<ConsoleEntry>()
  const requests = new Ring<NetworkEntry>()
  const undo: (() => void)[] = []
  let quiet = 0

  const log = (level: ConsoleEntry["level"], args: unknown[]) => {
    if (quiet) return
    logs.push({
      level,
      message: clip(args.map(describeValue).join(" ")),
      at: Date.now(),
    })
  }
  const failed = (method: string, url: string, status: number) => {
    if (quiet || ignore(url)) return
    requests.push({
      method: method.toUpperCase(),
      url: safeUrl(url),
      status,
      at: Date.now(),
    })
  }

  if (options.console) {
    for (const level of ["error", "warn"] as const) {
      const original = console[level]
      const wrapped = (...args: unknown[]) => {
        log(level, args)
        original.apply(console, args)
      }
      console[level] = wrapped
      undo.push(() => {
        // Another script may have wrapped it after us; leave theirs alone.
        if (console[level] === wrapped) console[level] = original
      })
    }
    const onError = (e: ErrorEvent) => {
      if (e.error) log("error", [e.error])
      else
        log("error", [
          `${e.message}${e.filename ? ` (${safeUrl(e.filename)}:${e.lineno})` : ""}`,
        ])
    }
    const onRejection = (e: PromiseRejectionEvent) =>
      log("error", ["Unhandled rejection:", e.reason])
    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRejection)
    undo.push(() => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
    })
  }

  if (options.network) {
    const originalFetch = window.fetch
    if (typeof originalFetch === "function") {
      const wrappedFetch: typeof fetch = async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        const method =
          init?.method ??
          (typeof input === "object" && "method" in input
            ? input.method
            : "GET")
        try {
          const response = await originalFetch.call(window, input, init)
          if (!response.ok && response.type !== "opaque")
            failed(method, url, response.status)
          return response
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError"))
            failed(method, url, 0)
          throw error
        }
      }
      window.fetch = wrappedFetch
      undo.push(() => {
        if (window.fetch === wrappedFetch) window.fetch = originalFetch
      })
    }

    const proto = window.XMLHttpRequest?.prototype
    if (proto) {
      const open = proto.open
      const send = proto.send
      const info = new WeakMap<
        XMLHttpRequest,
        { method: string; url: string }
      >()
      const wrappedOpen = function (
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        ...rest: unknown[]
      ) {
        info.set(this, { method, url: String(url) })
        return (open as (...args: unknown[]) => void).call(
          this,
          method,
          url,
          ...rest
        )
      } as typeof proto.open
      proto.open = wrappedOpen
      const wrappedSend = function (this: XMLHttpRequest, body) {
        const request = info.get(this)
        if (request) {
          let aborted = false
          this.addEventListener("abort", () => (aborted = true))
          this.addEventListener("loadend", () => {
            if (!aborted && (this.status === 0 || this.status >= 400))
              failed(request.method, request.url, this.status)
          })
        }
        return send.call(this, body)
      } as typeof proto.send
      proto.send = wrappedSend
      undo.push(() => {
        if (proto.open === wrappedOpen) proto.open = open
        if (proto.send === wrappedSend) proto.send = send
      })
    }
  }

  return {
    console: () => [...logs.items],
    network: () => [...requests.items],
    async quiet(fn) {
      quiet++
      try {
        return await fn()
      } finally {
        quiet--
      }
    },
    stop() {
      for (const fn of undo.splice(0)) fn()
    },
  }
}

const STYLE_PROPS = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "gap",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "color",
  "background-color",
  "border",
  "border-radius",
  "box-shadow",
  "opacity",
]

const ATTR_MAX = 200
const TEXT_MAX = 200

/** Remove what should never leave the page (form values) and trim the rest. */
function scrub(root: Element) {
  const walker = root.ownerDocument.createTreeWalker(root, 1 | 4)
  const drop: Node[] = []
  for (let node: Node | null = root; node; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      const text = node.textContent ?? ""
      if (text.length > TEXT_MAX)
        node.textContent = `${text.slice(0, TEXT_MAX)}…`
      continue
    }
    const el = node as Element
    const tag = el.tagName
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
      drop.push(el)
      continue
    }
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      el.removeAttribute("value")
      if (tag === "TEXTAREA") el.textContent = ""
    }
    if (tag === "OPTION") el.removeAttribute("selected")
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.length > ATTR_MAX)
        el.setAttribute(attr.name, `${attr.value.slice(0, ATTR_MAX)}…`)
    }
  }
  for (const node of drop) node.parentNode?.removeChild(node)
}

/** Clone at most `depth` levels of children. */
function shallowClone(el: Element, depth: number): Element {
  const copy = el.cloneNode(false) as Element
  if (depth > 0) {
    for (const child of Array.from(el.childNodes)) {
      copy.appendChild(
        child.nodeType === 1
          ? shallowClone(child as Element, depth - 1)
          : child.cloneNode(false)
      )
    }
  } else if (el.childElementCount) {
    copy.appendChild(
      el.ownerDocument.createComment(` ${el.childElementCount} more `)
    )
  }
  return copy
}

/** The element's markup and key computed styles, for design feedback. */
export function domContext(el: Element): DomContext {
  const max = LIMITS.domSnippetMaxLength
  let html = ""
  for (const depth of [Infinity, 3, 1, 0]) {
    const copy =
      depth === Infinity
        ? (el.cloneNode(true) as Element)
        : shallowClone(el, depth)
    scrub(copy)
    html = copy.outerHTML
    if (html.length <= max) break
  }
  if (html.length > max) html = `${html.slice(0, max - 1)}…`

  const styles: Record<string, string> = {}
  const computed = el.ownerDocument.defaultView?.getComputedStyle(el)
  for (const prop of STYLE_PROPS) {
    const value = computed?.getPropertyValue(prop).trim()
    if (value) styles[prop] = value
  }
  return { html, styles }
}
