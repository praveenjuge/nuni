import {
  LIMITS,
  MASK_ATTRIBUTE,
  stripUrlQueries,
  withoutQuery,
  type ConsoleEntry,
  type DomContext,
  type NetworkEntry,
} from "@nuni/shared"

import { CAPTURE_MARK } from "./mark"

export interface CaptureOptions {
  console: boolean
  network: boolean
}

export interface Collectors {
  console(): ConsoleEntry[]
  network(): NetworkEntry[]
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
    // Bounded, so logging a huge object stays cheap; the result is clipped anyway.
    let budget = 200
    const json = JSON.stringify(value, (_key, v: unknown) =>
      budget-- > 0 ? v : undefined
    )
    return json ?? String(value)
  } catch {
    return String(value)
  }
}

function clip(text: string): string {
  return text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX - 1)}…` : text
}

/** Origin + path only: query strings and hashes often carry tokens. */
export function safeUrl(input: string): string {
  return clip(withoutQuery(input, location.href))
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

  const log = (level: ConsoleEntry["level"], args: unknown[]) => {
    logs.push({
      level,
      message: clip(stripUrlQueries(args.map(describeValue).join(" "))),
      at: Date.now(),
    })
  }
  const failed = (method: string, url: string, status: number) => {
    if (ignore(url)) return
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
        // Nuni's own screenshot requests (see mark.ts) are not the page's.
        if (init && (init as Record<symbol, unknown>)[CAPTURE_MARK])
          return originalFetch.call(window, input, init)
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
          // Per-send listeners, removed when this request ends, so a reused
          // XHR never reports an earlier request again.
          let aborted = false
          const onAbort = () => (aborted = true)
          const onEnd = () => {
            this.removeEventListener("abort", onAbort)
            this.removeEventListener("loadend", onEnd)
            if (!aborted && (this.status === 0 || this.status >= 400))
              failed(request.method, request.url, this.status)
          }
          this.addEventListener("abort", onAbort)
          this.addEventListener("loadend", onEnd)
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

/** Replace an element's contents with a short note. */
function redact(el: Element, note: string) {
  el.replaceChildren(el.ownerDocument.createComment(` ${note} `))
}

/**
 * Remove what should never leave the page (form values, option lists and
 * masked areas) and trim the rest.
 */
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
    if (el.hasAttribute(MASK_ATTRIBUTE)) {
      for (const attr of Array.from(el.attributes)) {
        if (
          attr.name !== "id" &&
          attr.name !== "class" &&
          attr.name !== MASK_ATTRIBUTE
        )
          el.removeAttribute(attr.name)
      }
      redact(el, "masked")
      continue
    }
    if (tag === "INPUT" || tag === "TEXTAREA") {
      el.removeAttribute("value")
      if (tag === "TEXTAREA") el.textContent = ""
    }
    // Options can be the visitor's own data (saved addresses, accounts).
    if (tag === "SELECT" || tag === "DATALIST") {
      const count = el.getElementsByTagName("option").length
      redact(el, `${count} options`)
    }
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
  // depth -1: inside a masked area, only the bare tag is kept.
  const inMasked = Boolean(el.parentElement?.closest(`[${MASK_ATTRIBUTE}]`))
  for (const depth of inMasked ? [-1] : [Infinity, 3, 1, 0]) {
    const copy =
      depth === Infinity
        ? (el.cloneNode(true) as Element)
        : shallowClone(el, Math.max(0, depth))
    if (depth < 0) copy.setAttribute(MASK_ATTRIBUTE, "")
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
