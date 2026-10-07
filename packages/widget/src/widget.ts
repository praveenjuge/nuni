import {
  areaContainer,
  captureAnchor,
  captureArea,
  captureSelection,
  createResolveCache,
  elementText,
  frameDocument,
  frameElementOf,
  isRendered,
  isShadowRoot,
  pickTarget,
  resolveAnchor,
  scopeRootOf,
  textSimilarity,
  viewportRect,
  type Confidence,
} from "@nuni/anchor"
import {
  buildCommentPrompt,
  describeLocation,
  generateSecret,
  LIMITS,
  REACTIONS,
  type Anchor,
  type CommentContext,
  type DomContext,
  type OwnerComment,
  type ReplyView,
  type Thread,
  type WidgetComment,
} from "@nuni/shared"

import {
  NuniApi,
  NuniApiError,
  type PageSummary,
  type ProjectStatus,
} from "./api"
import type { ResolvedConfig } from "./config"
import { domContext, type Collectors } from "./context"
import {
  colorFor,
  copyText,
  h,
  icon,
  initials,
  parseColor,
  readableOn,
} from "./dom"
import { createI18n, type I18n, type MessageKey } from "./i18n"
import { ICONS } from "./icons"
import { onLocationChange } from "./navigation"
import type { CaptureScreenshot } from "./screenshot"
import { sha256Hex } from "./sha256"
import { scrollToPin } from "./scroll-to-pin"
import { KEYS, read, write } from "./storage"
import { STYLES } from "./styles"

interface Placement {
  element: Element | null
  confidence: Confidence
  /** A text comment's words, when they were found. */
  range?: Range
}

interface Draft {
  anchor: Anchor
  element: Element
  /** The selected words of a text comment. */
  range?: Range
  dom?: DomContext
  /** Taken while the person types and uploaded once the comment is posted. */
  screenshot?: Promise<Blob | null>
  error?: string
  sending?: boolean
}

export interface WidgetRuntime {
  collectors: Collectors
  loadScreenshot: (() => Promise<CaptureScreenshot | null>) | null
}

type Card =
  | { kind: "composer"; draft: Draft }
  | {
      kind: "thread"
      id: string
      editing?: boolean
      error?: string
      busy?: boolean
      /** The reply being edited. */
      replyEditing?: string
      /** The message (comment or reply id) whose emoji picker is open. */
      picker?: string | null
      sendingReply?: boolean
    }
  | null

const PICKING_CLASS = "nuni-picking"
const PICK_EVENTS = ["pointerdown", "mousedown", "pointerup", "mouseup"]
/** How far the pointer moves before a press becomes an area drag. */
const DRAG_THRESHOLD = 6

interface ViewBox {
  left: number
  top: number
  width: number
  height: number
}

/** The rectangles of a range that have a size (lines of text). */
function lineRects(range: Range): DOMRect[] {
  return Array.from(range.getClientRects()).filter(
    (r) => r.width > 0 && r.height > 0
  )
}

/** An area comment's box on screen, from its element's box. */
function regionBox(anchor: Anchor, el: Element): ViewBox | null {
  const region = anchor.region
  if (!region) return null
  const r = viewportRect(el, document)
  return {
    left: r.left + region.x * r.width,
    top: r.top + region.y * r.height,
    width: region.w * r.width,
    height: region.h * r.height,
  }
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim()

/** Run when the browser is idle, or soon. */
function whenIdle(fn: () => void) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(fn, { timeout: 100 })
  } else {
    setTimeout(fn, 0)
  }
}

/** Same-origin iframe documents on the page, nested ones too. */
function frameDocuments(doc: Document, depth = 0): Document[] {
  if (depth > 3) return []
  const out: Document[] = []
  for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
    const inner = frameDocument(frame)
    if (inner?.documentElement) {
      out.push(inner, ...frameDocuments(inner, depth + 1))
    }
  }
  return out
}
const MOBILE_QUERY = "(max-width: 640px)"

function isTypingTarget(target: EventTarget | null | undefined) {
  // nodeType, not instanceof: iframe elements come from another realm.
  if (!target || (target as Node).nodeType !== 1) return false
  const el = target as HTMLElement
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  )
}

function avatar(name: string): HTMLSpanElement {
  return h(
    "span",
    { class: "avatar", style: `background:${colorFor(name)}` },
    initials(name)
  )
}

function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ""
  const cls = Array.from(el.classList)
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join("")
  const text = elementText(el, 40)
  return `${tag}${id}${cls}${text ? ` "${text}"` : ""}`
}

/**
 * Build an "Other pages" link target, or null when it would leave the
 * current origin. The stored path comes from anonymous comment submissions;
 * one that does not start with "/" (".evil.com/x", "@evil.com/") would
 * extend or replace the host once the concatenated string is parsed as a
 * URL, sending the visitor - and the page's query string - to another site.
 */
export function otherPageHref(
  path: string,
  loc: { origin: string; search: string }
): string | null {
  const candidate = /[?#]/.test(path)
    ? loc.origin + path
    : loc.origin + path + loc.search
  try {
    return new URL(candidate).origin === loc.origin ? candidate : null
  } catch {
    return null
  }
}

export class NuniWidget {
  private host: HTMLElement
  private root: ShadowRoot
  private markLayer: HTMLDivElement
  private pinLayer: HTMLDivElement
  private overlayLayer: HTMLDivElement
  private selectButton: HTMLButtonElement
  private uiLayer: HTMLDivElement
  private api: NuniApi
  private cleanups: (() => void)[] = []
  private pageUnsub: (() => void) | null = null
  private sessionUnsub: (() => void) | null = null

  private pageKey = ""
  private comments: WidgetComment[] = []
  private loaded = false
  private placements = new Map<string, Placement>()
  private pins = new Map<string, HTMLButtonElement>()
  private status: ProjectStatus | null = null
  private pages: PageSummary[] = []

  private picking = false
  private panelOpen = false
  private tab: "open" | "resolved" = "open"
  private card: Card = null
  private activeId: string | null = null
  private hoverEl: Element | null = null
  private toastTimer = 0
  private toast: string | null = null

  private name = read(KEYS.name) ?? ""
  private secret: string
  private secretHash = ""
  private ownerToken: string | null
  private ownerName: string | null = null
  private deepLinkId: string | null = null
  /** A deep-linked comment that is outside the page listing window. */
  private extraComment: WidgetComment | null = null
  /** The open thread with its owner-only context, while an owner is signed in. */
  private ownerDetail: OwnerComment | null = null
  private ownerDetailId: string | null = null
  /** The subscription answered (possibly null), so the copy is complete. */
  private ownerDetailLoaded = false
  private ownerDetailUnsub: (() => void) | null = null
  /** Replies and reactions of the open thread. */
  private thread: Thread | null = null
  private threadId: string | null = null
  private threadUnsub: (() => void) | null = null

  /** Bumped by every resolve pass, so an older sliced pass stops. */
  private resolveRun = 0
  /** Shadow roots and iframes holding pins, watched for changes. */
  private scopeWatchers = new Map<Node, () => void>()
  /** Iframe documents listening while picking. */
  private pickDocs: Document[] = []
  /** Where the pointer went down while picking, for area drags. */
  private dragStart: { x: number; y: number } | null = null
  private dragBox: ViewBox | null = null
  /** A drag just ended: the click that follows it is not a pick. */
  private dragEnded = false
  /** The page's text selection, offered as a text comment. */
  private selection: Range | null = null
  private pointerDown = false
  private selectionFrame = 0
  /**
   * Where focus was before a card or the panel opened, to go back to: a
   * page element or a pin, or the focus key of a re-rendered widget button.
   */
  private returnFocus: HTMLElement | string | null = null
  /** Focus this (a selector in the UI) after the next render. */
  private focusNext: string | null = null
  /** An open "are you sure?" dialog. */
  private confirming: {
    message: string
    action: string
    done: (ok: boolean) => void
    /** Focus key of the button that asked, to go back to on Cancel. */
    from: string | null
  } | null = null
  private live: HTMLDivElement
  private layoutFrame = 0
  private pinPositions = new Map<string, { x: number; y: number }>()
  private resolveTimer = 0
  private i18n: I18n

  constructor(
    private config: ResolvedConfig,
    private runtime: WidgetRuntime
  ) {
    this.i18n = createI18n(config.locale, config.messages)
    let secret = read(KEYS.secret)
    if (!secret) {
      secret = generateSecret()
      write(KEYS.secret, secret)
    }
    this.secret = secret
    this.ownerToken = read(KEYS.session(config.project))

    this.host = document.createElement("div")
    this.host.id = "nuni-root"
    this.host.setAttribute("data-nuni", "")
    this.applyAppearance()
    this.root = this.host.attachShadow({ mode: "open" })
    const style = document.createElement("style")
    style.textContent = STYLES
    this.markLayer = h("div", { class: "marks", "aria-hidden": "true" })
    this.pinLayer = h("div", { class: "pins" })
    this.overlayLayer = h("div", { class: "overlay" })
    this.uiLayer = h("div", { class: "ui" })
    this.selectButton = h(
      "button",
      {
        class: "select-btn",
        type: "button",
        hidden: true,
        title: this.withKey("commentSelection", "commentSelectionKey"),
        // Keep the page's selection: a press would clear it.
        onmousedown: (e: Event) => e.preventDefault(),
        onpointerdown: (e: Event) => e.preventDefault(),
        onclick: () => this.commentOnSelection(),
      },
      icon(ICONS.comment),
      this.t("comment")
    )
    // Announcements for screen readers (what is selected while picking).
    this.live = h("div", { class: "sr", role: "status", "aria-live": "polite" })
    this.root.append(
      style,
      this.markLayer,
      this.pinLayer,
      this.overlayLayer,
      this.uiLayer,
      this.selectButton,
      this.live
    )
    this.uiLayer.addEventListener("keydown", (e) => this.trapFocus(e))

    this.api = new NuniApi(config)
  }

  private t(key: MessageKey, vars?: Record<string, string | number>) {
    return this.i18n.t(key, vars)
  }

  /** A message that names the hotkey, or the plain one when it is off. */
  private withKey(plain: MessageKey, keyed: MessageKey) {
    const key = this.config.hotkey
    return key ? this.t(keyed, { key: key.toUpperCase() }) : this.t(plain)
  }

  /** Position, theme, brand color and stacking order from the options. */
  private applyAppearance() {
    const { position, theme, accentColor, zIndex } = this.config
    this.host.dataset.position = position
    this.host.dataset.theme = theme
    if (zIndex !== null) this.host.style.zIndex = String(zIndex)
    const rgb = accentColor ? parseColor(accentColor) : null
    if (!rgb) return
    const [r, g, b] = rgb
    this.host.style.setProperty("--n-accent", `rgb(${r}, ${g}, ${b})`)
    this.host.style.setProperty(
      "--n-accent-soft",
      `rgba(${r}, ${g}, ${b}, 0.14)`
    )
    this.host.style.setProperty("--n-accent-fg", readableOn(rgb))
  }

  start() {
    document.body.appendChild(this.host)
    void sha256Hex(this.secret).then((hash) => {
      this.secretHash = hash
      this.render()
    })

    void this.api.touch(location.origin)
    this.cleanups.push(
      this.api.onStatus((status) => {
        this.status = status
        this.render()
      })
    )
    this.cleanups.push(
      this.api.onPages((pages) => {
        this.pages = pages
        this.render()
      })
    )
    if (this.ownerToken) this.watchSession(this.ownerToken)

    this.readDeepLink()
    this.subscribePage()

    this.cleanups.push(
      onLocationChange(() => {
        this.readDeepLink()
        this.subscribePage()
      })
    )

    const onKey = (e: KeyboardEvent) => this.onKeyDown(e)
    const onScroll = () => this.scheduleLayout()
    const onMessage = (e: MessageEvent) => this.onMessage(e)
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    })
    window.addEventListener("resize", onScroll, { passive: true })
    window.addEventListener("message", onMessage)
    const onSelection = () => this.scheduleSelection()
    const onDown = (e: PointerEvent) => {
      if (e.composedPath().includes(this.host)) return
      this.pointerDown = true
      this.scheduleSelection()
    }
    const onUp = () => {
      this.pointerDown = false
      this.scheduleSelection()
    }
    document.addEventListener("selectionchange", onSelection)
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("pointerup", onUp, true)
    this.cleanups.push(() => {
      document.removeEventListener("selectionchange", onSelection)
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("pointerup", onUp, true)
      cancelAnimationFrame(this.selectionFrame)
    })
    this.cleanups.push(() => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onScroll)
      window.removeEventListener("message", onMessage)
    })

    const mutations = new MutationObserver((records) => {
      if (
        records.every(
          (r) => this.host.contains(r.target) || r.target === this.host
        )
      )
        return
      this.scheduleResolve()
    })
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open", "id"],
    })
    const resize = new ResizeObserver(() => this.scheduleLayout())
    resize.observe(document.documentElement)
    this.cleanups.push(() => {
      mutations.disconnect()
      resize.disconnect()
    })

    this.render()
  }

  destroy() {
    this.setPicking(false)
    this.pageUnsub?.()
    this.sessionUnsub?.()
    this.ownerDetailUnsub?.()
    this.threadUnsub?.()
    this.resolveRun++
    for (const stop of this.scopeWatchers.values()) stop()
    this.scopeWatchers.clear()
    for (const cleanup of this.cleanups) cleanup()
    cancelAnimationFrame(this.layoutFrame)
    clearTimeout(this.resolveTimer)
    clearTimeout(this.toastTimer)
    this.host.remove()
    void this.api.close()
  }

  // ---------------------------------------------------------------- data

  private currentPageKey(): string {
    const url = new URL(location.href)
    return this.config.getPageKey(url)
  }

  private subscribePage() {
    const key = this.currentPageKey()
    if (key === this.pageKey && this.pageUnsub) return
    this.pageKey = key
    this.pageUnsub?.()
    this.comments = []
    this.extraComment = null
    this.loaded = false
    this.placements.clear()
    this.card = null
    this.activeId = null
    this.pageUnsub = this.api.onPage(
      key,
      (comments) => {
        const extra = this.extraComment
        const merged =
          extra && !comments.some((c) => c._id === extra._id)
            ? [...comments, extra]
            : comments
        this.comments = merged.sort((a, b) => a.createdAt - b.createdAt)
        this.loaded = true
        // Updates (a new comment, a reply count) keep pins that still fit.
        this.resolvePlacements(
          this.placements.size > 0,
          this.deepLinkId ?? undefined
        )
        this.openDeepLink()
        this.render()
      },
      () => {}
    )
    this.render()
  }

  private watchSession(token: string) {
    this.sessionUnsub?.()
    this.sessionUnsub = this.api.onSession(token, (result) => {
      if (result.valid) {
        this.ownerName = result.ownerName ?? this.t("owner")
      } else {
        this.ownerName = null
        this.ownerToken = null
        write(KEYS.session(this.config.project), null)
        this.sessionUnsub?.()
        this.sessionUnsub = null
      }
      this.render()
    })
  }

  /** Keep the owner-only details of the open thread subscribed. */
  private syncOwnerDetail() {
    const token = this.ownerToken
    const id =
      this.card?.kind === "thread" && this.isOwner && token
        ? this.card.id
        : null
    if (id === this.ownerDetailId) return
    this.ownerDetailUnsub?.()
    this.ownerDetailUnsub = null
    this.ownerDetail = null
    this.ownerDetailLoaded = false
    this.ownerDetailId = id
    if (!id || !token) return
    this.ownerDetailUnsub = this.api.onOwnerComment(id, token, (comment) => {
      if (this.ownerDetailId !== id) return
      this.ownerDetail = comment
      this.ownerDetailLoaded = true
      this.render()
    })
  }

  /** Keep the open thread's replies and reactions subscribed. */
  private syncThread() {
    const id = this.card?.kind === "thread" ? this.card.id : null
    if (id === this.threadId) return
    this.threadUnsub?.()
    this.threadUnsub = null
    this.thread = null
    this.threadId = id
    if (!id) return
    this.threadUnsub = this.api.onThread(id, (thread) => {
      if (this.threadId !== id) return
      this.thread = thread
      this.render()
    })
  }

  private get isOwner() {
    return Boolean(this.ownerToken && this.ownerName)
  }

  private isMine(comment: WidgetComment) {
    return Boolean(this.secretHash) && comment.authorKeyHash === this.secretHash
  }

  private visibleComments() {
    return this.comments.filter(
      (c) =>
        c.status ===
          (this.panelOpen && this.tab === "resolved" ? "resolved" : "open") ||
        (this.card?.kind === "thread" && this.card.id === c._id)
    )
  }

  // ------------------------------------------------------------ anchoring

  private isIgnored = (el: Element) =>
    el === this.host || this.host.contains(el)

  private scheduleResolve() {
    clearTimeout(this.resolveTimer)
    this.resolveTimer = window.setTimeout(
      () => this.resolvePlacements(true),
      200
    )
  }

  private stillPlaced(comment: WidgetComment) {
    const current = this.placements.get(comment._id)
    if (!current?.element?.isConnected) return false
    // A text comment: its words must still be where the range is (a range
    // over removed text collapses).
    const quote = comment.anchor.quote
    if (quote) {
      return (
        current.range !== undefined &&
        collapse(current.range.toString()) === quote.exact
      )
    }
    const text = elementText(current.element)
    const expected = comment.anchor.text
    return (
      !expected || text === expected || textSimilarity(text, expected) > 0.8
    )
  }

  /**
   * Find each comment's element. With `onlyStale`, keep placements whose
   * element is still attached and still looks like what was captured.
   * Works in slices of about 8 ms, so a page with many pins stays
   * responsive; `first` (a deep-linked comment) is found right away.
   */
  private resolvePlacements(onlyStale: boolean, first?: string) {
    const run = ++this.resolveRun
    const ids = new Set(this.comments.map((c) => c._id))
    for (const id of this.placements.keys())
      if (!ids.has(id)) this.placements.delete(id)

    const queue = this.comments.filter(
      (c) => !(onlyStale && this.stillPlaced(c))
    )
    const index = first ? queue.findIndex((c) => c._id === first) : -1
    if (index > 0) queue.unshift(...queue.splice(index, 1))
    // One cache per pass: lookups are shared by every pin on the page.
    const cache = createResolveCache()
    const options = { isIgnored: this.isIgnored, document }

    const slice = () => {
      if (run !== this.resolveRun) return
      const started = performance.now()
      while (queue.length) {
        const comment = queue.shift()!
        const result = resolveAnchor(comment.anchor, document, options, cache)
        this.placements.set(comment._id, {
          element: result.element,
          confidence: result.confidence,
          range: result.range,
        })
        if (performance.now() - started > 8) break
      }
      this.watchScopes()
      this.renderPins()
      this.layout()
      if (queue.length) whenIdle(slice)
      else if ((onlyStale || run > 1) && this.panelOpen) this.render()
    }
    slice()
  }

  /**
   * Pins inside shadow roots and iframes: the page's observers don't see
   * changes or scrolling in there, so watch each of those scopes too.
   */
  private watchScopes() {
    const roots = new Set<Node>()
    for (const { element } of this.placements.values()) {
      let node: Element | null = element
      for (let depth = 0; node && depth < 8; depth++) {
        const root = scopeRootOf(node)
        if (root === document) break
        roots.add(root)
        node = isShadowRoot(root) ? root.host : frameElementOf(root)
      }
    }
    for (const [root, stop] of this.scopeWatchers) {
      if (!roots.has(root)) {
        stop()
        this.scopeWatchers.delete(root)
      }
    }
    for (const root of roots) {
      if (!this.scopeWatchers.has(root)) {
        this.scopeWatchers.set(root, this.watchScope(root))
      }
    }
  }

  private watchScope(root: Node): () => void {
    const observer = new MutationObserver(() => this.scheduleResolve())
    const doc = isShadowRoot(root) ? null : (root as Document)
    observer.observe(doc ? (doc.body ?? doc.documentElement) : root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open", "id"],
    })
    const onScroll = () => this.scheduleLayout()
    // Scroll events don't leave a shadow root or an iframe.
    const target: EventTarget = doc?.defaultView ?? root
    target.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    })
    doc?.defaultView?.addEventListener("resize", onScroll, { passive: true })
    return () => {
      observer.disconnect()
      target.removeEventListener("scroll", onScroll, true)
      doc?.defaultView?.removeEventListener("resize", onScroll)
    }
  }

  private pinPoint(comment: WidgetComment): { x: number; y: number } | null {
    const placement = this.placements.get(comment._id)
    const el = placement?.element
    if (!el || !isRendered(el)) return null
    // In the page's viewport, also for elements inside iframes.
    const r = viewportRect(el, document)
    if (r.clipped) return null
    return this.anchorPoint(comment.anchor, el, placement.range)
  }

  /**
   * Where a pin goes: after the last selected word for a text comment, the
   * top-right corner of an area, or where the element was clicked.
   */
  private anchorPoint(
    anchor: Anchor,
    el: Element,
    range?: Range
  ): { x: number; y: number } {
    if (range && range.startContainer.ownerDocument === document) {
      const last = lineRects(range).at(-1)
      if (last) return { x: last.right, y: last.top + last.height / 2 }
    }
    const r = viewportRect(el, document)
    return {
      x: r.left + anchor.offset.x * r.width,
      y: r.top + anchor.offset.y * r.height,
    }
  }

  /**
   * Text comments underline their words, and the open comment (or the one
   * being written) also shows its words or its area strongly.
   */
  private renderMarks() {
    const marks: HTMLElement[] = []
    const add = (box: ViewBox, cls: string) => {
      const mark = h("div", { class: cls })
      Object.assign(mark.style, {
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      })
      marks.push(mark)
    }
    const show = (
      anchor: Anchor,
      el: Element | null | undefined,
      range: Range | undefined,
      active: boolean
    ) => {
      if (!el) return
      if (range && range.startContainer.ownerDocument === document) {
        for (const r of lineRects(range)) {
          add(r, active ? "mark mark-active" : "mark")
        }
      }
      if (active) {
        const box = regionBox(anchor, el)
        if (box) add(box, "area")
      }
    }
    if (this.card?.kind === "composer") {
      const { draft } = this.card
      show(draft.anchor, draft.element, draft.range, true)
    }
    for (const comment of this.visibleComments()) {
      const placement = this.placements.get(comment._id)
      const active = this.activeId === comment._id
      if (!active && (comment.status !== "open" || !comment.anchor.quote)) {
        continue
      }
      if (this.pins.get(comment._id)?.hidden) continue
      show(comment.anchor, placement?.element, placement?.range, active)
    }
    this.markLayer.replaceChildren(...marks)
  }

  private scheduleLayout() {
    if (this.layoutFrame) return
    this.layoutFrame = requestAnimationFrame(() => {
      this.layoutFrame = 0
      this.layout()
    })
  }

  private layout() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const taken: { x: number; y: number }[] = []
    this.pinPositions.clear()
    for (const comment of this.visibleComments()) {
      const pin = this.pins.get(comment._id)
      if (!pin) continue
      const point = this.pinPoint(comment)
      const visible =
        point &&
        point.x >= -10 &&
        point.y >= -10 &&
        point.x <= vw + 10 &&
        point.y <= vh + 10
      pin.hidden = !visible
      if (!point) continue
      // Fan out pins that land on the same spot so each stays clickable.
      const y = point.y
      let x = point.x
      while (
        taken.some((t) => Math.abs(t.x - x) < 14 && Math.abs(t.y - y) < 14)
      )
        x += 18
      taken.push({ x, y })
      this.pinPositions.set(comment._id, { x, y })
      pin.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    }
    this.renderMarks()
    this.positionCard()
    if (this.picking && (this.hoverEl || this.dragBox)) this.renderHighlight()
    this.placeSelectButton()
  }

  // --------------------------------------------------------------- picking

  private setPicking(on: boolean) {
    if (this.picking === on) return
    this.picking = on
    const html = document.documentElement
    this.dragStart = null
    this.dragBox = null
    if (on) {
      this.card = null
      if (window.matchMedia(MOBILE_QUERY).matches) this.panelOpen = false
      // The page and its same-origin iframes: anything in them can be picked.
      this.pickDocs = [document, ...frameDocuments(document)]
      for (const doc of this.pickDocs) {
        doc.documentElement.classList.add(PICKING_CLASS)
        this.injectCursorStyle(doc)
        doc.addEventListener("pointermove", this.onPickMove, true)
        doc.addEventListener("click", this.onPickClick, true)
        // Not touchstart: cancelling it would also cancel the tap's click.
        for (const type of PICK_EVENTS) {
          doc.addEventListener(type, this.swallow, {
            capture: true,
            passive: false,
          })
        }
        if (doc !== document) {
          doc.addEventListener("keydown", this.onFrameKey, true)
        }
      }
    } else {
      html.classList.remove(PICKING_CLASS)
      this.hoverEl = null
      for (const doc of this.pickDocs) {
        doc.documentElement?.classList.remove(PICKING_CLASS)
        doc.removeEventListener("pointermove", this.onPickMove, true)
        doc.removeEventListener("click", this.onPickClick, true)
        for (const type of PICK_EVENTS) {
          doc.removeEventListener(type, this.swallow, true)
        }
        doc.removeEventListener("keydown", this.onFrameKey, true)
      }
      this.pickDocs = []
    }
    this.render()
  }

  private onFrameKey = (e: KeyboardEvent) => this.onKeyDown(e)

  private injectCursorStyle(doc: Document) {
    if (doc.getElementById("nuni-cursor-style")) return
    const style = doc.createElement("style")
    style.id = "nuni-cursor-style"
    style.textContent = `html.${PICKING_CLASS}, html.${PICKING_CLASS} * { cursor: crosshair !important; }`
    ;(doc.head ?? doc.documentElement).appendChild(style)
    this.cleanups.push(() => style.remove())
  }

  /**
   * The element the event happened on, inside open shadow roots too
   * (composedPath), and never Nuni's own UI.
   */
  private fromPage(e: Event): Element | null {
    const path = e.composedPath()
    if (path.includes(this.host)) return null
    const target = path[0] ?? e.target
    // nodeType, not instanceof: iframe elements come from another realm.
    return target && (target as Node).nodeType === 1
      ? (target as Element)
      : null
  }

  private swallow = (e: Event) => {
    if (!this.fromPage(e)) return
    if (e.type === "pointerdown" && e instanceof PointerEvent) {
      const target = this.fromPage(e)
      if (target) {
        this.hoverEl = pickTarget(target)
        this.renderHighlight()
      }
      // A mouse drag on the page itself draws an area (not on touch, where
      // dragging scrolls).
      this.dragEnded = false
      this.dragStart =
        e.pointerType !== "touch" &&
        e.button === 0 &&
        (target?.ownerDocument ?? null) === document
          ? { x: e.clientX, y: e.clientY }
          : null
    }
    if (e.type === "pointerup" && this.dragBox) {
      const box = this.dragBox
      this.dragStart = null
      this.dragBox = null
      // Finish after this press's mouseup and click, which still have to be
      // kept from the page while picking is on.
      this.dragEnded = true
      setTimeout(() => {
        this.dragEnded = false
        if (this.picking) this.commentOnArea(box)
      }, 0)
    } else if (e.type === "pointerup") {
      this.dragStart = null
    }
    e.preventDefault()
    e.stopPropagation()
  }

  private onPickMove = (e: PointerEvent) => {
    const start = this.dragStart
    if (start) {
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (this.dragBox || Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        this.dragBox = {
          left: Math.min(start.x, e.clientX),
          top: Math.min(start.y, e.clientY),
          width: Math.abs(dx),
          height: Math.abs(dy),
        }
        this.renderHighlight()
        return
      }
    }
    const target = this.fromPage(e)
    const next = target ? pickTarget(target) : null
    if (next === this.hoverEl) return
    this.hoverEl = next
    this.renderHighlight()
  }

  private onPickClick = (e: MouseEvent) => {
    const target = this.fromPage(e)
    if (!target) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    // The click that ends an area drag.
    if (this.dragEnded) return
    const element = pickTarget(target)
    const anchor = captureAnchor(
      element,
      { x: e.clientX, y: e.clientY },
      { ignoreAttributePrefixes: [], document }
    )
    this.openComposer({ anchor, element })
  }

  /** An area drawn while picking: anchored to the element that covers it. */
  private commentOnArea(box: ViewBox) {
    const element = areaContainer(document, box, this.isIgnored)
    const anchor = captureArea(element, box, {
      ignoreAttributePrefixes: [],
      document,
    })
    this.openComposer({ anchor, element })
  }

  /** The page's selected text, if it can take a text comment. */
  private pageSelection(): Range | null {
    const selection = document.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      return null
    }
    const range = selection.getRangeAt(0)
    const node = range.commonAncestorContainer
    const el = node.nodeType === 1 ? (node as Element) : node.parentElement
    if (!el || el === this.host || this.host.contains(el)) return null
    // Text being typed (a field, an editor) is not page content.
    if (el.closest("input, textarea, select, [contenteditable]")) return null
    if (el.closest("[data-nuni]")) return null
    return collapse(range.toString()) ? range : null
  }

  private commentOnSelection() {
    const range = this.pageSelection()
    if (!range) return
    const captured = captureSelection(range, {
      ignoreAttributePrefixes: [],
      document,
    })
    if (!captured) return
    const kept = range.cloneRange()
    document.getSelection()?.removeAllRanges()
    this.selection = null
    this.openComposer({ ...captured, range: kept })
  }

  private scheduleSelection() {
    if (this.selectionFrame) return
    this.selectionFrame = requestAnimationFrame(() => {
      this.selectionFrame = 0
      this.selection =
        this.picking || this.pointerDown ? null : this.pageSelection()
      this.placeSelectButton()
    })
  }

  /** A small "Comment" button under the selected text. */
  private placeSelectButton() {
    const button = this.selectButton
    const range = this.selection
    const last = range ? lineRects(range).at(-1) : undefined
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (!range || !last || last.bottom < 0 || last.top > vh) {
      button.hidden = true
      return
    }
    button.hidden = false
    const width = button.offsetWidth || 96
    const height = button.offsetHeight || 32
    let top = last.bottom + 8
    if (top + height > vh - 8) top = last.top - height - 8
    const left = Math.max(8, Math.min(last.right - width / 2, vw - width - 8))
    button.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  }

  private openComposer(draft: Draft) {
    const { element } = draft
    this.setPicking(false)
    if (this.config.capture.dom) {
      try {
        draft.dom = domContext(element)
      } catch {
        // Context is a bonus; never block a comment on it.
      }
    }
    this.card = { kind: "composer", draft }
    this.activeId = null
    this.render()
    this.focusComposer()
    draft.screenshot = this.takeScreenshot(draft)
  }

  /** Capture while the person types, so posting stays instant. */
  private async takeScreenshot(draft: Draft): Promise<Blob | null> {
    const load = this.runtime.loadScreenshot
    // An iframe's document can't be rendered from the page.
    if (!load || draft.element.ownerDocument !== document) return null
    const accent =
      getComputedStyle(this.host).getPropertyValue("--n-accent").trim() ||
      "#d6246e"
    try {
      // Let the composer paint first; the capture clones part of the page.
      await new Promise((resolve) => setTimeout(resolve, 60))
      const capture = await load()
      const { range, anchor, element } = draft
      // Selected text or an area: the image centers on that part.
      const focus = range
        ? () => range.getBoundingClientRect()
        : anchor.region
          ? () => {
              const box = regionBox(anchor, element)!
              return {
                left: box.left,
                top: box.top,
                right: box.left + box.width,
                bottom: box.top + box.height,
              }
            }
          : undefined
      return capture
        ? await capture(element, { exclude: this.host, accent, focus })
        : null
    } catch {
      // No screenshot then; the comment still works.
      return null
    }
  }

  private collectContext(draft: Draft): CommentContext | undefined {
    const { collectors } = this.runtime
    const context: CommentContext = {}
    const logs = collectors.console()
    const failed = collectors.network()
    if (logs.length) context.console = logs
    if (failed.length) context.network = failed
    if (draft.dom) context.dom = draft.dom
    return Object.keys(context).length ? context : undefined
  }

  private async attachScreenshot(id: string, shot: Promise<Blob | null>) {
    try {
      // A capture still running when Post was clicked is sent when it lands.
      const image = await shot
      if (image) await this.api.uploadScreenshot(id, this.secret, image)
    } catch {
      // The comment is posted; the screenshot is optional.
    }
  }

  private copyForAgent(comment: WidgetComment) {
    const detail =
      this.ownerDetail?._id === comment._id ? this.ownerDetail : null
    const replies =
      this.threadId === comment._id ? this.thread?.replies : undefined
    const prompt = buildCommentPrompt(detail ?? { ...comment, replies }, {
      includeContext: Boolean(detail),
    })
    void copyText(prompt).then((ok) =>
      this.showToast(ok ? this.t("copied") : this.t("copyFailed"))
    )
  }

  private renderHighlight() {
    this.overlayLayer.replaceChildren()
    if (!this.picking) return
    const mobile = window.matchMedia(MOBILE_QUERY).matches
    this.overlayLayer.append(
      h(
        "div",
        { class: "pick-hint" },
        mobile
          ? this.t("pickHintMobile")
          : [
              h("span", {}, this.t("pickHint")),
              h("span", { class: "pick-keys" }, this.t("pickHintKeys")),
            ]
      )
    )
    if (this.dragBox) {
      const box = h("div", { class: "highlight drag-box" })
      Object.assign(box.style, {
        left: `${this.dragBox.left}px`,
        top: `${this.dragBox.top}px`,
        width: `${this.dragBox.width}px`,
        height: `${this.dragBox.height}px`,
      })
      this.overlayLayer.append(box)
      return
    }
    const el = this.hoverEl
    if (!el || el === el.ownerDocument.documentElement) return
    const r = viewportRect(el, document)
    const box = h(
      "div",
      { class: "highlight" },
      h("span", { class: "highlight-label" }, describeElement(el))
    )
    Object.assign(box.style, {
      left: `${r.left - 2}px`,
      top: `${r.top - 2}px`,
      width: `${r.width + 4}px`,
      height: `${r.height + 4}px`,
    })
    this.overlayLayer.append(box)
  }

  // ------------------------------------------------------------ keyboard

  private onKeyDown(e: KeyboardEvent) {
    const inWidget = e.composedPath().includes(this.host)
    if (e.key === "Escape") {
      if (this.confirming) this.answer(false)
      else if (this.picking) this.setPicking(false)
      else if (this.card) this.closeCard()
      else if (this.panelOpen) this.togglePanel(false)
      else return
      e.stopPropagation()
      return
    }
    // The real target, inside the widget's shadow root too.
    const target = e.composedPath()[0] ?? e.target
    if (isTypingTarget(target) || e.metaKey || e.ctrlKey || e.altKey) return
    // Arrows and Enter on the widget's own buttons keep their meaning.
    if (this.picking && !inWidget && this.onPickKey(e)) return
    if (inWidget && this.confirming) return
    if (e.repeat) return
    const hotkey = this.config.hotkey
    if (hotkey && e.key.toLowerCase() === hotkey) {
      e.preventDefault()
      // Selected text on the page: comment on those words.
      if (!this.picking && this.pageSelection()) this.commentOnSelection()
      else this.setPicking(!this.picking)
    }
  }

  /**
   * Picking without a mouse: arrows move to the parent, first child and
   * siblings; Enter comments on the highlighted element.
   */
  private onPickKey(e: KeyboardEvent): boolean {
    const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"]
    if (!keys.includes(e.key)) return false
    e.preventDefault()
    e.stopPropagation()
    let el = this.hoverEl
    if (!el || !el.isConnected) {
      this.movePickTo(this.keyboardStart())
      return true
    }
    if (e.key === "Enter") {
      const r = el.getBoundingClientRect()
      const anchor = captureAnchor(
        el,
        { x: r.left + r.width / 2, y: r.top + r.height / 2 },
        { ignoreAttributePrefixes: [], document }
      )
      this.openComposer({ anchor, element: el })
      return true
    }
    const visible = (n: Element | null) => {
      while (n && (n === this.host || !isRendered(n))) {
        n =
          e.key === "ArrowLeft"
            ? n.previousElementSibling
            : n.nextElementSibling
      }
      return n
    }
    const body = el.ownerDocument.body
    if (e.key === "ArrowUp") {
      if (el.parentElement && el !== body) el = el.parentElement
    } else if (e.key === "ArrowDown") {
      el = visible(el.firstElementChild) ?? el
    } else if (e.key === "ArrowLeft") {
      el = visible(el.previousElementSibling) ?? el
    } else {
      el = visible(el.nextElementSibling) ?? el
    }
    this.movePickTo(el)
    return true
  }

  /** Keyboard picking starts at the focused element, or mid-screen. */
  private keyboardStart(): Element {
    const focused = document.activeElement
    if (focused && focused !== document.body && focused !== this.host) {
      return focused
    }
    const middle = document
      .elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      .find((el) => !this.isIgnored(el))
    return middle ? pickTarget(middle) : document.body
  }

  private movePickTo(el: Element) {
    this.hoverEl = el
    el.scrollIntoView({ block: "nearest", inline: "nearest" })
    this.live.textContent = this.t("picked", { element: describeElement(el) })
    this.renderHighlight()
  }

  // ---------------------------------------------------------------- focus

  /** Tab stays inside an open card, the panel or a dialog. */
  private trapFocus(e: KeyboardEvent) {
    if (e.key !== "Tab") return
    const from = e.composedPath()[0] as HTMLElement | undefined
    const box = from?.closest?.<HTMLElement>(".confirm, [data-card], .panel")
    if (!box) return
    const items = Array.from(
      box.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, textarea, a[href], [tabindex="0"]'
      )
    ).filter((el) => !el.closest("[hidden]"))
    if (!items.length) return
    const first = items[0]!
    const last = items[items.length - 1]!
    const active = this.root.activeElement
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  /** Remember where focus was, before moving it into the widget. */
  private keepFocus() {
    if (this.returnFocus) return
    const inside = this.root.activeElement as HTMLElement | null
    if (inside) {
      this.returnFocus = inside.dataset.focusKey ?? inside
      return
    }
    const active = document.activeElement as HTMLElement | null
    this.returnFocus =
      active && active !== document.body && active !== this.host ? active : null
  }

  /** Back to where focus was before (when that is still there). */
  private restoreFocus() {
    const back = this.returnFocus
    this.returnFocus = null
    const target =
      typeof back === "string"
        ? this.uiLayer.querySelector<HTMLElement>(`[data-focus-key="${back}"]`)
        : back
    if (target?.isConnected) target.focus({ preventScroll: true })
  }

  /** An "are you sure?" dialog inside the widget. */
  private ask(message: string, action: string): Promise<boolean> {
    this.confirming?.done(false)
    const from =
      (this.root.activeElement as HTMLElement | null)?.dataset.focusKey ?? null
    return new Promise((resolve) => {
      this.confirming = { message, action, done: resolve, from }
      this.focusNext = '[data-focus-key="confirm-cancel"]'
      this.render()
    })
  }

  private answer(ok: boolean) {
    const confirming = this.confirming
    if (!confirming) return
    this.confirming = null
    if (!ok && confirming.from) {
      this.focusNext = `[data-focus-key="${confirming.from}"]`
    }
    this.render()
    confirming.done(ok)
  }

  private renderConfirm(): HTMLElement | null {
    const c = this.confirming
    if (!c) return null
    return h(
      "div",
      { class: "confirm-backdrop", onclick: () => this.answer(false) },
      h(
        "div",
        {
          class: "confirm",
          role: "alertdialog",
          "aria-modal": "true",
          "aria-labelledby": "nuni-confirm-text",
          onclick: (e: Event) => e.stopPropagation(),
        },
        h("p", { id: "nuni-confirm-text" }, c.message),
        h(
          "div",
          { class: "row" },
          h("span", { class: "spacer" }),
          h(
            "button",
            {
              class: "btn btn-ghost",
              type: "button",
              "data-focus-key": "confirm-cancel",
              onclick: () => this.answer(false),
            },
            this.t("cancel")
          ),
          h(
            "button",
            {
              class: "btn btn-danger-solid",
              type: "button",
              "data-focus-key": "confirm-ok",
              onclick: () => this.answer(true),
            },
            c.action
          )
        )
      )
    )
  }

  // --------------------------------------------------------------- claim

  private openClaim() {
    const url = new URL(`${this.config.appUrl}/dashboard/claim`)
    url.searchParams.set("project", this.config.project)
    url.searchParams.set("origin", location.origin)
    const popup = window.open(
      url.toString(),
      "nuni-claim",
      "popup,width=480,height=680"
    )
    if (!popup) location.href = url.toString()
  }

  private onMessage(e: MessageEvent) {
    let appOrigin: string
    try {
      appOrigin = new URL(this.config.appUrl).origin
    } catch {
      return
    }
    if (e.origin !== appOrigin) return
    const data = e.data as {
      type?: string
      project?: string
      token?: string
    } | null
    if (
      !data ||
      data.type !== "nuni:session" ||
      data.project !== this.config.project
    )
      return
    if (typeof data.token !== "string" || !data.token.startsWith("nuni_s_"))
      return
    this.ownerToken = data.token
    write(KEYS.session(this.config.project), data.token)
    this.watchSession(data.token)
    this.showToast(this.t("signedIn"))
  }

  // ------------------------------------------------------------ deep links

  private readDeepLink() {
    const url = new URL(location.href)
    const id = url.searchParams.get("nuni")
    if (!id) return
    this.deepLinkId = id
    url.searchParams.delete("nuni")
    history.replaceState(history.state, "", url.toString())
  }

  private openDeepLink() {
    const id = this.deepLinkId
    if (!id || !this.loaded) return
    this.deepLinkId = null
    const comment = this.comments.find((c) => c._id === id)
    if (comment) {
      this.focusDeepLinked(comment)
      return
    }
    // Older comments (e.g. long-resolved ones) are outside the page listing.
    void this.api.getComment(id).then((found) => {
      if (!found || found.page.path !== this.pageKey) {
        this.showToast(this.t("linkGone"))
        return
      }
      this.extraComment = found
      this.comments = [
        ...this.comments.filter((c) => c._id !== found._id),
        found,
      ]
      this.resolvePlacements(false, found._id)
      this.focusDeepLinked(found)
    })
  }

  private focusDeepLinked(comment: WidgetComment) {
    this.focusComment(comment._id)
  }

  private focusComment(id: string) {
    const placement = this.placements.get(id)
    const comment = this.comments.find((c) => c._id === id)
    if (placement?.element && comment)
      scrollToPin(placement.element, () =>
        this.anchorPoint(comment.anchor, placement.element!, placement.range)
      )
    this.openThread(id)
    if (window.matchMedia(MOBILE_QUERY).matches) this.panelOpen = false
    this.render()
    setTimeout(() => this.scheduleLayout(), 400)
  }

  // --------------------------------------------------------------- actions

  private async submitDraft(draft: Draft, body: string, name: string) {
    const cleanName = name.trim().slice(0, LIMITS.nameMaxLength)
    const cleanBody = body.trim()
    if (!cleanName) return this.setDraftError(draft, this.t("enterName"))
    if (!cleanBody) return this.setDraftError(draft, this.t("writeFirst"))
    if (cleanBody.length > LIMITS.bodyMaxLength) {
      return this.setDraftError(
        draft,
        this.t("commentTooLong", { count: LIMITS.bodyMaxLength })
      )
    }
    this.name = cleanName
    write(KEYS.name, cleanName)
    draft.sending = true
    draft.error = undefined
    this.render()

    const loc = describeLocation(location.href)
    const shot = draft.screenshot
    try {
      const id = await this.api.createComment({
        body: cleanBody,
        authorName: cleanName,
        authorSecret: this.secret,
        page: {
          ...loc,
          path: this.pageKey,
          title: document.title.slice(0, 300),
        },
        anchor: draft.anchor,
        viewport: {
          w: window.innerWidth,
          h: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
        },
        context: this.collectContext(draft),
      })
      if (shot) void this.attachScreenshot(id, shot)
      // Show the new pin exactly where it was dropped until it syncs.
      this.placements.set(id, {
        element: draft.element,
        confidence: "exact",
        range: draft.range,
      })
      if (this.card?.kind === "composer" && this.card.draft === draft)
        this.card = null
      this.showToast(this.t("added"))
    } catch (error) {
      draft.sending = false
      draft.error =
        error instanceof NuniApiError ? error.message : this.t("postFailed")
    }
    this.render()
  }

  private setDraftError(draft: Draft, message: string) {
    draft.error = message
    this.render()
  }

  /** Runs an action for the open thread. Resolves to true on success. */
  private async act(
    id: string,
    action: () => Promise<unknown>,
    done?: string
  ): Promise<boolean> {
    const card = this.card
    if (card?.kind === "thread") {
      card.busy = true
      card.error = undefined
      this.render()
    }
    try {
      await action()
      if (done) this.showToast(done)
      if (this.card?.kind === "thread" && this.card.id === id) {
        this.card.busy = false
        this.card.editing = false
      }
      this.render()
      return true
    } catch (error) {
      if (this.card?.kind === "thread" && this.card.id === id) {
        this.card.busy = false
        this.card.error =
          error instanceof Error ? error.message : this.t("failed")
      }
      this.render()
      return false
    }
  }

  private resolveComment(c: WidgetComment) {
    const token = this.ownerToken
    if (!token) return
    void this.act(
      c._id,
      () => this.api.resolve(c._id, token),
      this.t("resolved")
    ).then((ok) => {
      if (
        ok &&
        !(this.panelOpen && this.tab === "resolved") &&
        this.card?.kind === "thread" &&
        this.card.id === c._id
      )
        this.closeCard()
    })
  }

  private reopenComment(c: WidgetComment) {
    const token = this.ownerToken
    if (!token) return
    void this.act(
      c._id,
      () => this.api.reopen(c._id, token),
      this.t("reopened")
    )
  }

  private async deleteComment(c: WidgetComment) {
    const sure = await this.ask(
      this.t("confirmDeleteComment"),
      this.t("delete")
    )
    if (!sure) return
    const token = this.ownerToken
    const action = this.isMine(c)
      ? () => this.api.deleteOwn(c._id, this.secret)
      : token
        ? () => this.api.remove(c._id, token)
        : null
    if (!action) return
    // Keep the thread open on failure so the error stays visible.
    void this.act(c._id, action, this.t("deleted")).then((ok) => {
      if (!ok) return
      // The deep-link fallback is not part of the live subscription, so drop
      // it by hand or its pin would linger until the next navigation.
      if (this.extraComment?._id === c._id) this.extraComment = null
      this.comments = this.comments.filter((x) => x._id !== c._id)
      this.placements.delete(c._id)
      this.closeCard()
    })
  }

  private isMyReply(reply: ReplyView) {
    return Boolean(this.secretHash) && reply.authorKeyHash === this.secretHash
  }

  private async sendReply(comment: WidgetComment, body: string, name: string) {
    const card = this.card
    if (card?.kind !== "thread" || card.id !== comment._id) return
    const authorName = (this.isOwner ? this.ownerName : name)
      ?.trim()
      .slice(0, LIMITS.nameMaxLength)
    const clean = body.trim()
    if (!clean) return
    if (!authorName) {
      card.error = this.t("enterName")
      this.render()
      return
    }
    if (clean.length > LIMITS.bodyMaxLength) {
      card.error = this.t("replyTooLong", { count: LIMITS.bodyMaxLength })
      this.render()
      return
    }
    if (!this.isOwner) {
      this.name = authorName
      write(KEYS.name, authorName)
    }
    card.sendingReply = true
    card.error = undefined
    this.render()
    try {
      await this.api.createReply({
        commentId: comment._id,
        body: clean,
        authorName,
        authorSecret: this.secret,
        sessionToken: this.ownerToken ?? undefined,
      })
      const box = this.uiLayer.querySelector<HTMLTextAreaElement>(
        '[data-focus-key="reply"]'
      )
      if (box) box.value = ""
    } catch (error) {
      card.error =
        error instanceof NuniApiError ? error.message : this.t("replyFailed")
    }
    card.sendingReply = false
    this.render()
  }

  private toggleReaction(
    comment: WidgetComment,
    targetId: string,
    emoji: string
  ) {
    void this.api
      .toggleReaction(comment._id, targetId, emoji, this.secret)
      .catch((error: unknown) => {
        if (this.card?.kind === "thread" && this.card.id === comment._id) {
          this.card.error =
            error instanceof Error ? error.message : this.t("reactFailed")
          this.render()
        }
      })
  }

  private async deleteReply(comment: WidgetComment, reply: ReplyView) {
    const sure = await this.ask(this.t("confirmDeleteReply"), this.t("delete"))
    if (!sure) return
    const token = this.ownerToken
    const action = this.isMyReply(reply)
      ? () => this.api.deleteReply(reply._id, this.secret)
      : token
        ? () => this.api.removeReply(reply._id, token)
        : null
    if (action) void this.act(comment._id, action, this.t("replyDeleted"))
  }

  private saveReplyEdit(
    comment: WidgetComment,
    reply: ReplyView,
    body: string
  ) {
    void this.act(
      comment._id,
      () => this.api.editReply(reply._id, this.secret, body),
      this.t("saved")
    ).then((ok) => {
      if (ok && this.card?.kind === "thread") {
        this.card.replyEditing = undefined
        this.render()
      }
    })
  }

  private saveEdit(c: WidgetComment, body: string) {
    void this.act(
      c._id,
      () => this.api.editOwn(c._id, this.secret, body),
      this.t("saved")
    )
  }

  // ----------------------------------------------------------------- UI

  private showToast(message: string) {
    this.toast = message
    clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => {
      this.toast = null
      this.render()
    }, 2400)
    this.render()
  }

  private togglePanel(open = !this.panelOpen) {
    if (open === this.panelOpen) return
    this.panelOpen = open
    if (open) {
      this.keepFocus()
      this.focusNext = '.panel [role="tab"][aria-selected="true"]'
      if (window.matchMedia(MOBILE_QUERY).matches) this.card = null
    }
    this.render()
    if (!open && !this.card) this.restoreFocus()
  }

  private closeCard() {
    const had = this.card !== null
    this.card = null
    this.activeId = null
    this.render()
    if (had && !this.panelOpen) this.restoreFocus()
  }

  /** Open a comment's thread and move focus into it. */
  private openThread(id: string) {
    this.keepFocus()
    this.activeId = id
    this.card = { kind: "thread", id }
    this.focusNext = '[data-card="thread"] .card-close'
  }

  private render() {
    this.syncOwnerDetail()
    this.syncThread()
    this.renderPins()
    this.renderUi()
    this.renderHighlight()
    this.layout()
  }

  private renderPins() {
    const visible = this.visibleComments()
    const keep = new Set(visible.map((c) => c._id))
    for (const [id, pin] of this.pins) {
      if (!keep.has(id)) {
        pin.remove()
        this.pins.delete(id)
      }
    }
    for (const comment of visible) {
      let pin = this.pins.get(comment._id)
      if (!pin) {
        pin = h("button", { class: "pin", type: "button", hidden: true })
        const id = comment._id
        pin.addEventListener("click", (e) => {
          e.stopPropagation()
          if (this.card?.kind === "thread" && this.card.id === id)
            this.closeCard()
          else {
            this.openThread(id)
            this.render()
          }
        })
        this.pins.set(comment._id, pin)
        this.pinLayer.append(pin)
      }
      pin.textContent = initials(comment.authorName)
      pin.style.background = colorFor(comment.authorName)
      pin.setAttribute(
        "aria-label",
        this.t("pinLabel", {
          name: comment.authorName,
          body: comment.body.slice(0, 80),
        })
      )
      if (comment.replyCount) pin.dataset.replies = String(comment.replyCount)
      else delete pin.dataset.replies
      pin.dataset.status = comment.status
      pin.dataset.active = String(this.activeId === comment._id)
      pin.dataset.confidence =
        this.placements.get(comment._id)?.confidence ?? "lost"
    }
    // Draft pin while composing
    const draftPin = this.pinLayer.querySelector(".pin-draft")
    draftPin?.remove()
    if (this.card?.kind === "composer") {
      const { draft } = this.card
      const { x, y } = this.anchorPoint(
        draft.anchor,
        draft.element,
        draft.range
      )
      const pin = h(
        "div",
        { class: "pin pin-draft pin-pending", "aria-hidden": "true" },
        this.name ? initials(this.name) : "+"
      )
      pin.style.background = this.name ? colorFor(this.name) : "var(--n-accent)"
      pin.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
      this.pinLayer.append(pin)
    }
  }

  private renderUi() {
    const nodes: Node[] = [this.renderToolbar()]
    if (this.panelOpen) nodes.push(this.renderPanel())
    const card = this.renderCard()
    if (card) nodes.push(card)
    if (this.toast)
      nodes.push(h("div", { class: "toast", role: "status" }, this.toast))
    const confirm = this.renderConfirm()
    if (confirm) nodes.push(confirm)
    const focused = this.root.activeElement as HTMLElement | null
    const focusKey = focused?.dataset.focusKey
    const selection =
      focused instanceof HTMLTextAreaElement ||
      focused instanceof HTMLInputElement
        ? { start: focused.selectionStart, end: focused.selectionEnd }
        : null
    this.uiLayer.replaceChildren(...nodes)
    const next = this.focusNext
    this.focusNext = null
    const wanted = next ? this.uiLayer.querySelector<HTMLElement>(next) : null
    if (wanted) wanted.focus()
    else if (focusKey) {
      const next = this.uiLayer.querySelector<HTMLElement>(
        `[data-focus-key="${focusKey}"]`
      )
      next?.focus()
      if (
        selection &&
        (next instanceof HTMLTextAreaElement ||
          next instanceof HTMLInputElement)
      ) {
        next.setSelectionRange(selection.start, selection.end)
      }
    }
    this.positionCard()
  }

  private renderToolbar() {
    const open = this.comments.filter((c) => c.status === "open").length
    return h(
      "div",
      { class: "toolbar", role: "toolbar", "aria-label": this.t("toolbar") },
      h(
        "button",
        {
          class: "tb-btn",
          type: "button",
          "aria-pressed": String(this.picking),
          "data-focus-key": "tb-comment",
          "aria-label": this.picking
            ? this.t("cancelAdding")
            : this.t("addComment"),
          title: this.withKey("addComment", "addCommentKey"),
          onclick: () => this.setPicking(!this.picking),
        },
        icon(ICONS.comment),
        h(
          "span",
          { class: "tb-label" },
          this.picking
            ? this.t("pickElement")
            : (this.config.label ?? this.t("comment"))
        )
      ),
      h(
        "button",
        {
          class: "tb-btn",
          type: "button",
          "aria-pressed": String(this.panelOpen),
          "data-focus-key": "tb-panel",
          "aria-label": this.t("openCount", { count: open }),
          title: this.t("allComments"),
          onclick: () => this.togglePanel(),
        },
        icon(ICONS.list),
        h("span", { class: "tb-count" }, String(open))
      )
    )
  }

  private renderPanel() {
    const open = this.comments.filter((c) => c.status === "open")
    const resolved = this.comments.filter((c) => c.status === "resolved")
    const list = this.tab === "open" ? open : resolved
    const placed = list.filter((c) => this.placements.get(c._id)?.element)
    const lost = list.filter((c) => !this.placements.get(c._id)?.element)
    const otherPages = this.pages.filter((p) => p.path !== this.pageKey)

    const item = (c: WidgetComment) =>
      h(
        "button",
        {
          class: "item",
          type: "button",
          "data-focus-key": `item-${c._id}`,
          onclick: () => this.focusComment(c._id),
        },
        h(
          "div",
          { class: "row" },
          h(
            "span",
            { class: "avatar", style: `background:${colorFor(c.authorName)}` },
            initials(c.authorName)
          ),
          h("span", { class: "author" }, c.authorName),
          h(
            "span",
            { class: "meta" },
            this.i18n.timeAgo(c.createdAt) +
              (c.replyCount
                ? ` · ${this.t("replyCount", { count: c.replyCount })}`
                : "")
          ),
          c.page.origin !== location.origin
            ? h(
                "span",
                { class: "badge", title: c.page.origin },
                new URL(c.page.origin).host
              )
            : null
        ),
        c.anchor.quote
          ? h("div", { class: "item-quote" }, c.anchor.quote.exact)
          : null,
        h("div", { class: "item-text" }, c.body)
      )

    const children: Node[] = []
    if (!this.loaded) {
      children.push(h("div", { class: "empty" }, this.t("loading")))
    } else if (!list.length) {
      children.push(
        h(
          "div",
          { class: "empty" },
          this.tab === "open"
            ? this.withKey("noOpen", "noOpenKey")
            : this.t("noResolved")
        )
      )
    } else {
      children.push(...placed.map(item))
      if (lost.length) {
        children.push(
          h("div", { class: "section-label" }, this.t("notFoundHere"))
        )
        children.push(...lost.map(item))
      }
    }
    if (otherPages.length) {
      children.push(h("div", { class: "section-label" }, this.t("otherPages")))
      for (const p of otherPages.slice(0, 20)) {
        const href = otherPageHref(p.path, location)
        children.push(
          h(
            href === null ? "div" : "a",
            href === null ? { class: "item" } : { class: "item", href },
            h(
              "div",
              { class: "row" },
              h("span", { class: "author" }, p.path),
              h("span", { class: "spacer" }),
              h(
                "span",
                { class: "badge" },
                this.t("openOnPage", { count: p.count })
              )
            )
          )
        )
      }
    }

    return h(
      "div",
      { class: "panel", role: "dialog", "aria-label": this.t("comments") },
      h(
        "div",
        { class: "panel-head" },
        h("div", { class: "panel-title" }, this.t("comments")),
        h(
          "button",
          {
            class: "btn btn-ghost btn-icon",
            type: "button",
            "aria-label": this.t("close"),
            onclick: () => this.togglePanel(false),
          },
          icon(ICONS.close)
        )
      ),
      h(
        "div",
        {
          class: "tabs",
          role: "tablist",
          "aria-label": this.t("comments"),
          // Arrow keys move between the tabs; Tab moves on to the list.
          onkeydown: (e: Event) => {
            const key = (e as KeyboardEvent).key
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) {
              return
            }
            e.preventDefault()
            this.tab =
              key === "Home"
                ? "open"
                : key === "End"
                  ? "resolved"
                  : this.tab === "open"
                    ? "resolved"
                    : "open"
            this.focusNext = `[data-focus-key="tab-${this.tab}"]`
            this.render()
          },
        },
        (["open", "resolved"] as const).map((tab) =>
          h(
            "button",
            {
              class: "tab",
              role: "tab",
              type: "button",
              id: `nuni-tab-${tab}`,
              "data-focus-key": `tab-${tab}`,
              "aria-selected": String(this.tab === tab),
              "aria-controls": "nuni-panel-list",
              tabindex: this.tab === tab ? 0 : -1,
              onclick: () => {
                this.tab = tab
                this.render()
              },
            },
            tab === "open"
              ? this.t("tabOpen", { count: open.length })
              : this.t("tabResolved", { count: resolved.length })
          )
        )
      ),
      h(
        "div",
        {
          class: "panel-list",
          id: "nuni-panel-list",
          role: "tabpanel",
          "aria-labelledby": `nuni-tab-${this.tab}`,
        },
        ...children
      ),
      this.status && !this.status.claimed && !this.isOwner
        ? this.renderPanelFooter()
        : null
    )
  }

  private renderPanelFooter() {
    return h(
      "div",
      { class: "panel-foot" },
      h(
        "div",
        { class: "row" },
        h("span", { class: "meta" }, this.t("ownSite")),
        h("span", { class: "spacer" }),
        h(
          "button",
          { class: "btn", type: "button", onclick: () => this.openClaim() },
          icon(ICONS.github),
          this.t("claim")
        )
      )
    )
  }

  private renderComposer(draft: Draft, cls: string): HTMLElement {
    const needsName = !this.name
    const avatar = h("span", {
      class: "avatar cmp-avatar",
      "aria-hidden": "true",
    })
    const paintAvatar = (name: string) => {
      const clean = name.trim()
      avatar.classList.toggle("avatar-empty", !clean)
      if (clean) {
        avatar.textContent = initials(clean)
        avatar.style.background = colorFor(clean)
      } else {
        avatar.replaceChildren(icon(ICONS.user))
        avatar.style.background = ""
      }
    }
    const nameInput = h("input", {
      class: "cmp-name",
      placeholder: this.t("yourName"),
      value: this.name,
      maxlength: LIMITS.nameMaxLength,
      autocomplete: "name",
      "data-focus-key": "name",
      "aria-label": this.t("yourName"),
    })
    const textarea = h("textarea", {
      class: "cmp-text",
      placeholder: this.t("leaveComment"),
      maxlength: LIMITS.bodyMaxLength,
      rows: 3,
      "data-focus-key": "body",
      "aria-label": this.t("comment"),
    })
    const prev = this.uiLayer.querySelector<HTMLTextAreaElement>(
      '[data-focus-key="body"]'
    )
    if (prev) textarea.value = prev.value
    const prevName = this.uiLayer.querySelector<HTMLInputElement>(
      '[data-focus-key="name"]'
    )
    if (prevName) nameInput.value = prevName.value
    paintAvatar(needsName ? nameInput.value : this.name)
    nameInput.addEventListener("input", () => paintAvatar(nameInput.value))

    // Only shown close to the limit, so it never adds noise.
    const counter = h("span", { class: "cmp-count", "aria-live": "polite" })
    const post = h(
      "button",
      {
        class: "cmp-post",
        type: "submit",
        disabled: Boolean(draft.sending) || !textarea.value.trim(),
      },
      draft.sending ? this.t("posting") : this.t("post"),
      icon(ICONS.arrowUp)
    )
    const update = () => {
      post.disabled = Boolean(draft.sending) || !textarea.value.trim()
      const left = LIMITS.bodyMaxLength - textarea.value.length
      counter.textContent =
        left <= LIMITS.bodyMaxLength * 0.1
          ? this.t("charsLeft", { count: left })
          : ""
      // Grow with the text, up to the max height in the styles.
      textarea.style.height = "auto"
      textarea.style.height = `${textarea.scrollHeight + 2}px`
    }
    textarea.addEventListener("input", () => {
      update()
      this.positionCard()
    })
    requestAnimationFrame(() => {
      if (!textarea.isConnected) return
      update()
      this.positionCard()
    })

    const submit = () =>
      void this.submitDraft(
        draft,
        textarea.value,
        needsName ? nameInput.value : this.name
      )
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        submit()
      }
    })
    return h(
      "form",
      {
        class: `${cls} composer`,
        "data-card": "composer",
        onsubmit: (e: Event) => {
          e.preventDefault()
          submit()
        },
      },
      h(
        "div",
        { class: "cmp-head" },
        avatar,
        needsName ? nameInput : h("span", { class: "author" }, this.name),
        h("span", { class: "spacer" }),
        needsName
          ? null
          : h(
              "button",
              {
                class: "cmp-link",
                type: "button",
                onclick: () => {
                  this.name = ""
                  this.render()
                  this.focusComposer()
                },
              },
              this.t("notYou")
            )
      ),
      draft.anchor.quote
        ? h("blockquote", { class: "quote" }, draft.anchor.quote.exact)
        : null,
      textarea,
      draft.error
        ? h("div", { class: "error cmp-error", role: "alert" }, draft.error)
        : null,
      h(
        "div",
        { class: "cmp-foot" },
        h(
          "span",
          { class: "cmp-keys", title: this.t("send", { key: this.i18n.mod }) },
          h("kbd", {}, this.i18n.mod),
          h("kbd", {}, "↵")
        ),
        counter,
        h("span", { class: "spacer" }),
        post
      ),
      // Last in tab order, so Tab goes from the name to the comment.
      h(
        "button",
        {
          class: "icon-btn cmp-close",
          type: "button",
          "aria-label": this.t("cancel"),
          title: this.t("cancel"),
          onclick: () => this.closeCard(),
        },
        icon(ICONS.close)
      )
    )
  }

  private renderCard(): HTMLElement | null {
    const card = this.card
    if (!card) return null
    const mobile = window.matchMedia(MOBILE_QUERY).matches
    const cls = `card${mobile ? " sheet" : ""}`

    if (card.kind === "composer") return this.renderComposer(card.draft, cls)

    const comment = this.comments.find((c) => c._id === card.id)
    if (!comment) return null
    const mine = this.isMine(comment)
    const owner = this.isOwner
    const placement = this.placements.get(comment._id)

    let body: Node
    if (card.editing) {
      const textarea = h("textarea", {
        class: "field",
        maxlength: LIMITS.bodyMaxLength,
        "data-focus-key": "edit",
      })
      const prev = this.uiLayer.querySelector<HTMLTextAreaElement>(
        '[data-focus-key="edit"]'
      )
      textarea.value = prev ? prev.value : comment.body
      body = h(
        "div",
        { class: "card-body" },
        textarea,
        h(
          "div",
          { class: "row" },
          h("span", { class: "spacer" }),
          h(
            "button",
            {
              class: "btn btn-ghost",
              type: "button",
              onclick: () => {
                card.editing = false
                this.render()
              },
            },
            this.t("cancel")
          ),
          h(
            "button",
            {
              class: "btn btn-primary",
              type: "button",
              disabled: Boolean(card.busy),
              onclick: () => this.saveEdit(comment, textarea.value),
            },
            this.t("save")
          )
        )
      )
    } else {
      const badges = [
        comment.status === "resolved"
          ? h(
              "span",
              { class: "badge badge-ok" },
              icon(ICONS.check),
              this.t("resolved")
            )
          : null,
        comment.page.origin !== location.origin
          ? h(
              "span",
              {
                class: "badge",
                title: this.t("leftOn", { origin: comment.page.origin }),
              },
              new URL(comment.page.origin).host
            )
          : null,
        placement?.confidence === "low"
          ? h(
              "span",
              { class: "badge", title: this.t("approximateHint") },
              this.t("approximate")
            )
          : null,
        !placement?.element
          ? h(
              "span",
              {
                class: "badge",
                title: this.t("originallyOn", {
                  text: comment.anchor.text || comment.anchor.tag,
                }),
              },
              this.t("notFound")
            )
          : null,
      ].filter((badge) => badge !== null)
      // Owners copy the full context, so wait until it has loaded.
      const contextPending =
        owner && !(this.ownerDetailLoaded && this.ownerDetailId === comment._id)
      const resolved = comment.status === "resolved"
      body = h(
        "div",
        { class: "card-body msg" },
        h(
          "div",
          { class: "card-head" },
          avatar(comment.authorName),
          h("span", { class: "author" }, comment.authorName),
          h(
            "span",
            { class: "meta" },
            this.i18n.timeAgo(comment.createdAt) +
              (comment.editedAt ? ` · ${this.t("edited")}` : "")
          ),
          h("span", { class: "spacer" }),
          owner
            ? h(
                "button",
                {
                  class: `icon-btn${resolved ? " is-resolved" : ""}`,
                  type: "button",
                  "aria-label": this.t(resolved ? "reopen" : "resolve"),
                  title: this.t(resolved ? "reopen" : "resolve"),
                  disabled: Boolean(card.busy),
                  onclick: () =>
                    resolved
                      ? this.reopenComment(comment)
                      : this.resolveComment(comment),
                },
                icon(ICONS.check)
              )
            : null,
          h(
            "button",
            {
              class: "icon-btn card-close",
              type: "button",
              "aria-label": this.t("close"),
              title: this.t("close"),
              onclick: () => this.closeCard(),
            },
            icon(ICONS.close)
          )
        ),
        h(
          "div",
          { class: "msg-main" },
          comment.anchor.quote
            ? h("blockquote", { class: "quote" }, comment.anchor.quote.exact)
            : null,
          h("div", { class: "comment-body" }, comment.body),
          this.ownerDetail?._id === comment._id &&
            this.ownerDetail.screenshotUrl
            ? h(
                "a",
                {
                  class: "shot",
                  href: this.ownerDetail.screenshotUrl,
                  target: "_blank",
                  rel: "noreferrer",
                  title: this.t("openScreenshot"),
                },
                h("img", {
                  src: this.ownerDetail.screenshotUrl,
                  alt: this.t("screenshotTaken"),
                })
              )
            : null,
          badges.length ? h("div", { class: "badges" }, ...badges) : null,
          h(
            "div",
            { class: "msg-foot" },
            this.renderReactions(comment, comment._id),
            h("span", { class: "spacer" }),
            h(
              "button",
              {
                class: "icon-btn",
                type: "button",
                "aria-label": this.t("copyForAgent"),
                title: contextPending
                  ? this.t("loadingContext")
                  : this.t("copyForAgentHint"),
                disabled: contextPending,
                onclick: () => this.copyForAgent(comment),
              },
              icon(ICONS.bot)
            ),
            mine
              ? h(
                  "button",
                  {
                    class: "icon-btn",
                    type: "button",
                    "aria-label": this.t("edit"),
                    title: this.t("edit"),
                    onclick: () => {
                      card.editing = true
                      this.render()
                    },
                  },
                  icon(ICONS.edit)
                )
              : null,
            mine || owner
              ? h(
                  "button",
                  {
                    class: "icon-btn icon-btn-danger",
                    type: "button",
                    "aria-label": this.t("delete"),
                    title: this.t("delete"),
                    "data-focus-key": "delete",
                    disabled: Boolean(card.busy),
                    onclick: () => void this.deleteComment(comment),
                  },
                  icon(ICONS.trash)
                )
              : null
          ),
          card.error
            ? h("div", { class: "error", role: "alert" }, card.error)
            : null
        )
      )
    }

    return h(
      "div",
      {
        class: cls,
        "data-card": "thread",
        role: "dialog",
        "aria-label": this.t("commentBy", { name: comment.authorName }),
      },
      body,
      card.editing ? null : this.renderThread(comment)
    )
  }

  /**
   * Emoji chips for one message and the picker to add one. Replies keep
   * their add button with their other tools, so `withAdd` is off for them.
   */
  private renderReactions(
    comment: WidgetComment,
    targetId: string,
    withAdd = true
  ) {
    const card = this.card
    if (card?.kind !== "thread") return null
    const loaded = this.threadId === comment._id && this.thread
    const summaries = loaded
      ? this.thread!.reactions.filter((r) => r.targetId === targetId)
      : []
    const open = card.picker === targetId
    if (!withAdd && !summaries.length && !open) return null
    return h(
      "div",
      { class: "reactions" },
      ...summaries.map((r) => {
        const mine = r.authorKeyHashes.includes(this.secretHash)
        return h(
          "button",
          {
            class: "reaction",
            type: "button",
            "aria-pressed": String(mine),
            "aria-label": `${r.emoji} ${r.count}${mine ? ", including you" : ""}`,
            onclick: () => this.toggleReaction(comment, targetId, r.emoji),
          },
          `${r.emoji} ${r.count}`
        )
      }),
      withAdd ? this.reactionAdd(targetId, "reaction reaction-add") : null,
      open
        ? h(
            "div",
            {
              class: "reaction-picker",
              role: "group",
              "aria-label": this.t("reactions"),
            },
            ...REACTIONS.map((emoji) =>
              h(
                "button",
                {
                  class: "reaction",
                  type: "button",
                  "aria-label": this.t("reactWith", { emoji }),
                  onclick: () => {
                    card.picker = null
                    this.toggleReaction(comment, targetId, emoji)
                    this.render()
                  },
                },
                emoji
              )
            )
          )
        : null
    )
  }

  private reactionAdd(targetId: string, cls: string) {
    const card = this.card
    if (card?.kind !== "thread") return null
    const open = card.picker === targetId
    return h(
      "button",
      {
        class: cls,
        type: "button",
        "aria-label": this.t("addReaction"),
        "aria-expanded": String(open),
        title: this.t("addReaction"),
        onclick: () => {
          card.picker = open ? null : targetId
          this.render()
        },
      },
      icon(ICONS.smile)
    )
  }

  /** The replies under a comment and the box to add one. */
  private renderThread(comment: WidgetComment) {
    const card = this.card
    if (card?.kind !== "thread") return null
    const replies =
      this.threadId === comment._id ? (this.thread?.replies ?? []) : []
    const owner = this.isOwner

    const items = replies.map((reply) => {
      const mine = this.isMyReply(reply)
      if (card.replyEditing === reply._id) {
        const box = h("textarea", {
          class: "field",
          maxlength: LIMITS.bodyMaxLength,
          "data-focus-key": `reply-edit-${reply._id}`,
          "aria-label": this.t("editReply"),
        })
        const prev = this.uiLayer.querySelector<HTMLTextAreaElement>(
          `[data-focus-key="reply-edit-${reply._id}"]`
        )
        box.value = prev ? prev.value : reply.body
        return h(
          "div",
          { class: "reply" },
          box,
          h(
            "div",
            { class: "row" },
            h("span", { class: "spacer" }),
            h(
              "button",
              {
                class: "btn btn-ghost",
                type: "button",
                onclick: () => {
                  card.replyEditing = undefined
                  this.render()
                },
              },
              this.t("cancel")
            ),
            h(
              "button",
              {
                class: "btn btn-primary",
                type: "button",
                disabled: Boolean(card.busy),
                onclick: () => this.saveReplyEdit(comment, reply, box.value),
              },
              this.t("save")
            )
          )
        )
      }
      return h(
        "div",
        { class: "reply msg", "data-reply": reply._id },
        h(
          "div",
          { class: "card-head" },
          avatar(reply.authorName),
          h("span", { class: "author" }, reply.authorName),
          reply.isOwner
            ? h("span", { class: "badge badge-owner" }, this.t("owner"))
            : null,
          h(
            "span",
            { class: "meta" },
            this.i18n.timeAgo(reply.createdAt) +
              (reply.editedAt ? ` · ${this.t("edited")}` : "")
          ),
          h("span", { class: "spacer" }),
          h(
            "span",
            { class: "msg-tools" },
            this.reactionAdd(reply._id, "icon-btn"),
            mine
              ? h(
                  "button",
                  {
                    class: "icon-btn",
                    type: "button",
                    "aria-label": this.t("editReply"),
                    title: this.t("edit"),
                    onclick: () => {
                      card.replyEditing = reply._id
                      this.render()
                    },
                  },
                  icon(ICONS.edit)
                )
              : null,
            mine || owner
              ? h(
                  "button",
                  {
                    class: "icon-btn icon-btn-danger",
                    type: "button",
                    "aria-label": this.t("deleteReply"),
                    title: this.t("delete"),
                    "data-focus-key": `delete-${reply._id}`,
                    disabled: Boolean(card.busy),
                    onclick: () => void this.deleteReply(comment, reply),
                  },
                  icon(ICONS.trash)
                )
              : null
          )
        ),
        h(
          "div",
          { class: "msg-main" },
          h("div", { class: "comment-body" }, reply.body),
          this.renderReactions(comment, reply._id, false)
        )
      )
    })

    const needsName = !owner && !this.name
    const nameInput = h("input", {
      class: "reply-name",
      placeholder: this.t("yourName"),
      value: this.name,
      maxlength: LIMITS.nameMaxLength,
      autocomplete: "name",
      "data-focus-key": "reply-name",
      "aria-label": this.t("yourName"),
    })
    const prevName = this.uiLayer.querySelector<HTMLInputElement>(
      '[data-focus-key="reply-name"]'
    )
    if (prevName) nameInput.value = prevName.value
    const box = h("textarea", {
      class: "reply-text",
      placeholder: replies.length ? this.t("reply") : this.t("replyFirst"),
      maxlength: LIMITS.bodyMaxLength,
      rows: 1,
      "data-focus-key": "reply",
      "aria-label": this.t("reply"),
    })
    const prev = this.uiLayer.querySelector<HTMLTextAreaElement>(
      '[data-focus-key="reply"]'
    )
    if (prev) box.value = prev.value
    const sendButton = h(
      "button",
      {
        class: "reply-send",
        type: "submit",
        "aria-label": this.t("sendReply"),
        title: this.t("sendReply"),
        disabled: Boolean(card.sendingReply) || !box.value.trim(),
      },
      icon(ICONS.arrowUp)
    )
    // Grow with the text, up to the max height in the styles.
    const grow = () => {
      sendButton.disabled = Boolean(card.sendingReply) || !box.value.trim()
      box.style.height = "auto"
      box.style.height = `${box.scrollHeight}px`
    }
    box.addEventListener("input", grow)
    requestAnimationFrame(() => {
      if (box.isConnected) grow()
    })
    const send = () =>
      void this.sendReply(
        comment,
        box.value,
        needsName ? nameInput.value : this.name
      )
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        send()
      }
    })

    return h(
      "div",
      { class: "thread" },
      items.length
        ? h(
            "div",
            {
              class: "replies",
              role: "list",
              "aria-label": this.t("replyCount", { count: items.length }),
            },
            ...items.map((item) => {
              item.setAttribute("role", "listitem")
              return item
            })
          )
        : null,
      h(
        "form",
        {
          class: "reply-form",
          onsubmit: (e: Event) => {
            e.preventDefault()
            send()
          },
        },
        needsName ? nameInput : null,
        h("div", { class: "reply-row" }, box, sendButton)
      )
    )
  }

  private positionCard() {
    const el = this.uiLayer.querySelector<HTMLElement>("[data-card]")
    if (!el || el.classList.contains("sheet")) return
    let point: { x: number; y: number } | null = null
    if (this.card?.kind === "composer") {
      const { draft } = this.card
      point = this.anchorPoint(draft.anchor, draft.element, draft.range)
    } else if (this.card?.kind === "thread") {
      const comment = this.comments.find(
        (c) => this.card?.kind === "thread" && c._id === this.card.id
      )
      point = comment
        ? (this.pinPositions.get(comment._id) ?? this.pinPoint(comment))
        : null
    }
    const width = el.offsetWidth || 320
    const height = el.offsetHeight || 160
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left: number
    let top: number
    if (point) {
      left = point.x + 36
      top = point.y - 28
      if (left + width > vw - 12) left = point.x - width - 12
    } else {
      // Next to the toolbar, in its corner.
      const { position } = this.config
      left = position.endsWith("left") ? 16 : vw - width - 16
      top = position.startsWith("top") ? 72 : vh - height - 72
    }
    left = Math.max(12, Math.min(left, vw - width - 12))
    top = Math.max(12, Math.min(top, vh - height - 12))
    el.style.left = `${Math.round(left)}px`
    el.style.top = `${Math.round(top)}px`
  }

  private focusComposer() {
    requestAnimationFrame(() => {
      const target = this.uiLayer.querySelector<HTMLElement>(
        this.name ? '[data-focus-key="body"]' : '[data-focus-key="name"]'
      )
      target?.focus()
    })
  }
}
