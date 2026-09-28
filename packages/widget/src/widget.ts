import {
  captureAnchor,
  elementText,
  isRendered,
  pickTarget,
  resolveAnchor,
  textSimilarity,
  type Confidence,
} from "@nuni/anchor"
import {
  describeLocation,
  generateSecret,
  LIMITS,
  normalizePath,
  type Anchor,
  type WidgetComment,
} from "@nuni/shared"

import {
  NuniApi,
  NuniApiError,
  type PageSummary,
  type ProjectStatus,
} from "./api"
import type { ResolvedConfig } from "./config"
import { colorFor, h, icon, initials, timeAgo } from "./dom"
import { ICONS } from "./icons"
import { onLocationChange } from "./navigation"
import { sha256Hex } from "./sha256"
import { KEYS, read, write } from "./storage"
import { STYLES } from "./styles"

interface Placement {
  element: Element | null
  confidence: Confidence
}

interface Draft {
  anchor: Anchor
  element: Element
  error?: string
  sending?: boolean
}

type Card =
  | { kind: "composer"; draft: Draft }
  | {
      kind: "thread"
      id: string
      editing?: boolean
      error?: string
      busy?: boolean
    }
  | null

const PICKING_CLASS = "nuni-picking"
const MOBILE_QUERY = "(max-width: 640px)"

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
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

export class NuniWidget {
  private host: HTMLElement
  private root: ShadowRoot
  private pinLayer: HTMLDivElement
  private overlayLayer: HTMLDivElement
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
  private status: ProjectStatus = {
    exists: false,
    claimed: false,
    ownerName: null,
    openCount: 0,
  }
  private pages: PageSummary[] = []

  private picking = false
  private panelOpen = false
  private tab: "open" | "resolved" = "open"
  private showResolved = read(KEYS.showResolved) === "1"
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

  private layoutFrame = 0
  private pinPositions = new Map<string, { x: number; y: number }>()
  private resolveTimer = 0

  constructor(private config: ResolvedConfig) {
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
    this.root = this.host.attachShadow({ mode: "open" })
    const style = document.createElement("style")
    style.textContent = STYLES
    this.pinLayer = h("div", { class: "pins" })
    this.overlayLayer = h("div", { class: "overlay" })
    this.uiLayer = h("div", { class: "ui" })
    this.root.append(style, this.pinLayer, this.overlayLayer, this.uiLayer)

    this.api = new NuniApi(config)
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
    return this.config.getPageKey?.(url) ?? normalizePath(url)
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
        this.resolvePlacements(false)
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
        this.ownerName = result.ownerName ?? "Owner"
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

  private get isOwner() {
    return Boolean(this.ownerToken && this.ownerName)
  }

  private isMine(comment: WidgetComment) {
    return Boolean(this.secretHash) && comment.authorKeyHash === this.secretHash
  }

  private visibleComments() {
    return this.comments.filter((c) => c.status === "open" || this.showResolved)
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

  /**
   * Find each comment's element. With `onlyStale`, keep placements whose
   * element is still attached and still looks like what was captured.
   */
  private resolvePlacements(onlyStale: boolean) {
    const ids = new Set(this.comments.map((c) => c._id))
    for (const id of this.placements.keys())
      if (!ids.has(id)) this.placements.delete(id)

    for (const comment of this.comments) {
      const current = this.placements.get(comment._id)
      if (onlyStale && current?.element && current.element.isConnected) {
        const text = elementText(current.element)
        const expected = comment.anchor.text
        if (
          !expected ||
          text === expected ||
          textSimilarity(text, expected) > 0.8
        )
          continue
      }
      const result = resolveAnchor(comment.anchor, document, {
        isIgnored: this.isIgnored,
      })
      this.placements.set(comment._id, {
        element: result.element,
        confidence: result.confidence,
      })
    }
    this.renderPins()
    this.layout()
    if (onlyStale && this.panelOpen) this.render()
  }

  private pinPoint(comment: WidgetComment): { x: number; y: number } | null {
    const placement = this.placements.get(comment._id)
    const el = placement?.element
    if (!el || !isRendered(el)) return null
    const r = el.getBoundingClientRect()
    return {
      x: r.left + comment.anchor.offset.x * r.width,
      y: r.top + comment.anchor.offset.y * r.height,
    }
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
    this.positionCard()
    if (this.picking && this.hoverEl) this.renderHighlight()
  }

  // --------------------------------------------------------------- picking

  private setPicking(on: boolean) {
    if (this.picking === on) return
    this.picking = on
    const html = document.documentElement
    if (on) {
      this.card = null
      if (window.matchMedia(MOBILE_QUERY).matches) this.panelOpen = false
      html.classList.add(PICKING_CLASS)
      this.injectCursorStyle()
      document.addEventListener("pointermove", this.onPickMove, true)
      document.addEventListener("click", this.onPickClick, true)
      // Not touchstart: cancelling it would also cancel the tap's click.
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        document.addEventListener(type, this.swallow, {
          capture: true,
          passive: false,
        })
      }
    } else {
      html.classList.remove(PICKING_CLASS)
      this.hoverEl = null
      document.removeEventListener("pointermove", this.onPickMove, true)
      document.removeEventListener("click", this.onPickClick, true)
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        document.removeEventListener(type, this.swallow, true)
      }
    }
    this.render()
  }

  private injectCursorStyle() {
    if (document.getElementById("nuni-cursor-style")) return
    const style = document.createElement("style")
    style.id = "nuni-cursor-style"
    style.textContent = `html.${PICKING_CLASS}, html.${PICKING_CLASS} * { cursor: crosshair !important; }`
    document.head.appendChild(style)
    this.cleanups.push(() => style.remove())
  }

  private fromPage(e: Event): Element | null {
    if (e.composedPath().includes(this.host)) return null
    const target = e.target
    return target instanceof Element ? target : null
  }

  private swallow = (e: Event) => {
    if (!this.fromPage(e)) return
    if (e.type === "pointerdown" && e instanceof PointerEvent) {
      const target = this.fromPage(e)
      if (target) {
        this.hoverEl = pickTarget(target)
        this.renderHighlight()
      }
    }
    e.preventDefault()
    e.stopPropagation()
  }

  private onPickMove = (e: PointerEvent) => {
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
    const element = pickTarget(target)
    const anchor = captureAnchor(
      element,
      { x: e.clientX, y: e.clientY },
      { ignoreAttributePrefixes: [] }
    )
    this.setPicking(false)
    this.card = { kind: "composer", draft: { anchor, element } }
    this.render()
    this.focusComposer()
  }

  private renderHighlight() {
    this.overlayLayer.replaceChildren()
    if (!this.picking) return
    this.overlayLayer.append(
      h(
        "div",
        { class: "pick-hint" },
        "Click anything to comment · Esc to cancel"
      )
    )
    const el = this.hoverEl
    if (!el || el === document.documentElement) return
    const r = el.getBoundingClientRect()
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
      if (this.picking) this.setPicking(false)
      else if (this.card) this.closeCard()
      else if (this.panelOpen) this.togglePanel(false)
      else return
      e.stopPropagation()
      return
    }
    if (
      inWidget ||
      isTypingTarget(e.target) ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      e.repeat
    )
      return
    if (e.key === "c" || e.key === "C") {
      e.preventDefault()
      this.setPicking(!this.picking)
    }
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
    this.showToast("You're signed in as the owner")
  }

  private signOut() {
    if (this.ownerToken) void this.api.signOut(this.ownerToken)
    write(KEYS.session(this.config.project), null)
    this.ownerToken = null
    this.ownerName = null
    this.sessionUnsub?.()
    this.sessionUnsub = null
    this.render()
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
        this.showToast("That comment was deleted or is on another page")
        return
      }
      this.extraComment = found
      this.comments = [
        ...this.comments.filter((c) => c._id !== found._id),
        found,
      ]
      this.resolvePlacements(false)
      this.focusDeepLinked(found)
    })
  }

  private focusDeepLinked(comment: WidgetComment) {
    if (comment.status === "resolved" && !this.showResolved) {
      this.showResolved = true
      this.renderPins()
    }
    this.focusComment(comment._id)
  }

  private focusComment(id: string) {
    const placement = this.placements.get(id)
    placement?.element?.scrollIntoView({ block: "center", behavior: "smooth" })
    this.activeId = id
    this.card = { kind: "thread", id }
    if (window.matchMedia(MOBILE_QUERY).matches) this.panelOpen = false
    this.render()
    setTimeout(() => this.scheduleLayout(), 400)
  }

  // --------------------------------------------------------------- actions

  private async submitDraft(draft: Draft, body: string, name: string) {
    const cleanName = name.trim().slice(0, LIMITS.nameMaxLength)
    const cleanBody = body.trim()
    if (!cleanName) return this.setDraftError(draft, "Enter your name")
    if (!cleanBody) return this.setDraftError(draft, "Write a comment first")
    if (cleanBody.length > LIMITS.bodyMaxLength) {
      return this.setDraftError(
        draft,
        `Comments are limited to ${LIMITS.bodyMaxLength} characters`
      )
    }
    this.name = cleanName
    write(KEYS.name, cleanName)
    draft.sending = true
    draft.error = undefined
    this.render()

    const loc = describeLocation(location.href)
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
      })
      // Show the new pin exactly where it was dropped until it syncs.
      this.placements.set(id, { element: draft.element, confidence: "exact" })
      if (this.card?.kind === "composer" && this.card.draft === draft)
        this.card = null
      this.showToast("Comment added")
    } catch (error) {
      draft.sending = false
      draft.error =
        error instanceof NuniApiError
          ? error.message
          : "Couldn't post the comment"
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
          error instanceof Error ? error.message : "Something went wrong"
      }
      this.render()
      return false
    }
  }

  private resolveComment(c: WidgetComment) {
    const token = this.ownerToken
    if (!token) return
    void this.act(c._id, () => this.api.resolve(c._id, token), "Resolved").then(
      (ok) => {
        if (
          ok &&
          !this.showResolved &&
          this.card?.kind === "thread" &&
          this.card.id === c._id
        )
          this.closeCard()
      }
    )
  }

  private reopenComment(c: WidgetComment) {
    const token = this.ownerToken
    if (!token) return
    void this.act(c._id, () => this.api.reopen(c._id, token), "Reopened")
  }

  private deleteComment(c: WidgetComment) {
    if (!window.confirm("Delete this comment? This can't be undone.")) return
    const token = this.ownerToken
    const action = this.isMine(c)
      ? () => this.api.deleteOwn(c._id, this.secret)
      : token
        ? () => this.api.remove(c._id, token)
        : null
    if (!action) return
    // Keep the thread open on failure so the error stays visible.
    void this.act(c._id, action, "Deleted").then((ok) => ok && this.closeCard())
  }

  private saveEdit(c: WidgetComment, body: string) {
    void this.act(
      c._id,
      () => this.api.editOwn(c._id, this.secret, body),
      "Saved"
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
    this.panelOpen = open
    if (open && window.matchMedia(MOBILE_QUERY).matches) this.card = null
    this.render()
  }

  private closeCard() {
    this.card = null
    this.activeId = null
    this.render()
  }

  private render() {
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
            this.activeId = id
            this.card = { kind: "thread", id }
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
        `Comment by ${comment.authorName}: ${comment.body.slice(0, 80)}`
      )
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
      const r = draft.element.getBoundingClientRect()
      const x = r.left + draft.anchor.offset.x * r.width
      const y = r.top + draft.anchor.offset.y * r.height
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
    const focused = this.root.activeElement as HTMLElement | null
    const focusKey = focused?.dataset.focusKey
    const selection =
      focused instanceof HTMLTextAreaElement ||
      focused instanceof HTMLInputElement
        ? { start: focused.selectionStart, end: focused.selectionEnd }
        : null
    this.uiLayer.replaceChildren(...nodes)
    if (focusKey) {
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
      { class: "toolbar", role: "toolbar", "aria-label": "Nuni comments" },
      h(
        "button",
        {
          class: "tb-btn",
          type: "button",
          "aria-pressed": String(this.picking),
          "aria-label": this.picking
            ? "Cancel adding a comment"
            : "Add a comment",
          title: "Add a comment (C)",
          onclick: () => this.setPicking(!this.picking),
        },
        icon(ICONS.comment),
        h(
          "span",
          { class: "tb-label" },
          this.picking ? "Pick an element" : "Comment"
        )
      ),
      h(
        "button",
        {
          class: "tb-btn",
          type: "button",
          "aria-pressed": String(this.panelOpen),
          "aria-label": `Comments on this page: ${open} open`,
          title: "All comments",
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
          onclick: () => {
            if (c.status === "resolved" && !this.showResolved) {
              this.showResolved = true
              write(KEYS.showResolved, "1")
            }
            this.focusComment(c._id)
          },
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
          h("span", { class: "meta" }, timeAgo(c.createdAt)),
          c.page.origin !== location.origin
            ? h(
                "span",
                { class: "badge", title: c.page.origin },
                new URL(c.page.origin).host
              )
            : null
        ),
        h("div", { class: "item-text" }, c.body)
      )

    const children: Node[] = []
    if (!this.loaded) children.push(h("div", { class: "empty" }, "Loading…"))
    else if (!list.length) {
      children.push(
        h(
          "div",
          { class: "empty" },
          this.tab === "open"
            ? "No open comments on this page. Press C to add one."
            : "Nothing resolved yet."
        )
      )
    } else {
      children.push(...placed.map(item))
      if (lost.length) {
        children.push(
          h("div", { class: "section-label" }, "Couldn't find on this page")
        )
        children.push(...lost.map(item))
      }
    }
    if (otherPages.length) {
      children.push(h("div", { class: "section-label" }, "Other pages"))
      for (const p of otherPages.slice(0, 20)) {
        const href = p.path.includes("#")
          ? location.origin + p.path
          : location.origin + p.path + location.search
        children.push(
          h(
            "a",
            { class: "item", href },
            h(
              "div",
              { class: "row" },
              h("span", { class: "author" }, p.path),
              h("span", { class: "spacer" }),
              h("span", { class: "badge" }, `${p.count} open`)
            )
          )
        )
      }
    }

    return h(
      "div",
      { class: "panel", role: "dialog", "aria-label": "Comments" },
      h(
        "div",
        { class: "panel-head" },
        h("div", { class: "panel-title" }, "Comments"),
        h(
          "button",
          {
            class: "btn btn-ghost btn-icon",
            type: "button",
            "aria-label": "Close",
            onclick: () => this.togglePanel(false),
          },
          icon(ICONS.close)
        )
      ),
      h(
        "div",
        { class: "tabs", role: "tablist" },
        h(
          "button",
          {
            class: "tab",
            role: "tab",
            type: "button",
            "aria-selected": String(this.tab === "open"),
            onclick: () => {
              this.tab = "open"
              this.render()
            },
          },
          `Open (${open.length})`
        ),
        h(
          "button",
          {
            class: "tab",
            role: "tab",
            type: "button",
            "aria-selected": String(this.tab === "resolved"),
            onclick: () => {
              this.tab = "resolved"
              this.render()
            },
          },
          `Resolved (${resolved.length})`
        )
      ),
      h("div", { class: "panel-list" }, ...children),
      this.renderPanelFooter()
    )
  }

  private renderPanelFooter() {
    const resolvedToggle = h(
      "label",
      { class: "toggle" },
      h("input", {
        type: "checkbox",
        checked: this.showResolved,
        onchange: (e: Event) => {
          this.showResolved = (e.target as HTMLInputElement).checked
          write(KEYS.showResolved, this.showResolved ? "1" : null)
          this.render()
        },
      }),
      "Show resolved pins"
    )
    let ownership: Node
    if (this.isOwner) {
      ownership = h(
        "div",
        { class: "row" },
        h("span", { class: "badge badge-ok" }, icon(ICONS.check), "Owner"),
        h("span", { class: "meta" }, this.ownerName ?? ""),
        h("span", { class: "spacer" }),
        h(
          "a",
          {
            class: "link",
            href: `${this.config.appUrl}/dashboard/p/${this.config.project}`,
            target: "_blank",
            rel: "noopener",
          },
          "Dashboard"
        ),
        h(
          "button",
          { class: "link", type: "button", onclick: () => this.signOut() },
          "Sign out"
        )
      )
    } else if (this.status.claimed) {
      ownership = h(
        "div",
        { class: "row" },
        h(
          "span",
          { class: "meta" },
          `Managed by ${this.status.ownerName ?? "the owner"}`
        ),
        h("span", { class: "spacer" }),
        h(
          "button",
          { class: "link", type: "button", onclick: () => this.openClaim() },
          "Owner sign in"
        )
      )
    } else {
      ownership = h(
        "div",
        { class: "row" },
        h("span", { class: "meta" }, "Own this website?"),
        h("span", { class: "spacer" }),
        h(
          "button",
          { class: "btn", type: "button", onclick: () => this.openClaim() },
          icon(ICONS.github),
          "Claim Nuni"
        )
      )
    }
    return h("div", { class: "panel-foot" }, resolvedToggle, ownership)
  }

  private renderCard(): HTMLElement | null {
    const card = this.card
    if (!card) return null
    const mobile = window.matchMedia(MOBILE_QUERY).matches
    const cls = `card${mobile ? " sheet" : ""}`

    if (card.kind === "composer") {
      const { draft } = card
      const needsName = !this.name
      const nameInput = h("input", {
        class: "field",
        placeholder: "Your name",
        value: this.name,
        maxlength: LIMITS.nameMaxLength,
        autocomplete: "name",
        "data-focus-key": "name",
        "aria-label": "Your name",
      })
      const textarea = h("textarea", {
        class: "field",
        placeholder: "Leave a comment",
        maxlength: LIMITS.bodyMaxLength,
        "data-focus-key": "body",
        "aria-label": "Comment",
      })
      const prev = this.uiLayer.querySelector<HTMLTextAreaElement>(
        '[data-focus-key="body"]'
      )
      if (prev) textarea.value = prev.value
      const prevName = this.uiLayer.querySelector<HTMLInputElement>(
        '[data-focus-key="name"]'
      )
      if (prevName) nameInput.value = prevName.value
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
          class: cls,
          "data-card": "composer",
          onsubmit: (e: Event) => {
            e.preventDefault()
            submit()
          },
        },
        h(
          "div",
          { class: "card-body" },
          needsName
            ? nameInput
            : h(
                "div",
                { class: "row" },
                h(
                  "span",
                  {
                    class: "avatar",
                    style: `background:${colorFor(this.name)}`,
                  },
                  initials(this.name)
                ),
                h("span", { class: "author" }, this.name),
                h("span", { class: "spacer" }),
                h(
                  "button",
                  {
                    class: "link",
                    type: "button",
                    onclick: () => {
                      this.name = ""
                      this.render()
                    },
                  },
                  "Not you?"
                )
              ),
          textarea,
          draft.error
            ? h("div", { class: "error", role: "alert" }, draft.error)
            : null,
          h(
            "div",
            { class: "row" },
            h("span", { class: "kbd" }, "⌘ + Enter"),
            h("span", { class: "spacer" }),
            h(
              "button",
              {
                class: "btn btn-ghost",
                type: "button",
                onclick: () => this.closeCard(),
              },
              "Cancel"
            ),
            h(
              "button",
              {
                class: "btn btn-primary",
                type: "submit",
                disabled: Boolean(draft.sending),
              },
              icon(ICONS.send),
              draft.sending ? "Posting…" : "Post"
            )
          )
        )
      )
    }

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
            "Cancel"
          ),
          h(
            "button",
            {
              class: "btn btn-primary",
              type: "button",
              disabled: Boolean(card.busy),
              onclick: () => this.saveEdit(comment, textarea.value),
            },
            "Save"
          )
        )
      )
    } else {
      body = h(
        "div",
        { class: "card-body" },
        h(
          "div",
          { class: "card-head" },
          h(
            "span",
            {
              class: "avatar",
              style: `background:${colorFor(comment.authorName)}`,
            },
            initials(comment.authorName)
          ),
          h("span", { class: "author" }, comment.authorName),
          h(
            "span",
            { class: "meta" },
            timeAgo(comment.createdAt) + (comment.editedAt ? " · edited" : "")
          ),
          h("span", { class: "spacer" }),
          h(
            "button",
            {
              class: "btn btn-ghost btn-icon",
              type: "button",
              "aria-label": "Close",
              onclick: () => this.closeCard(),
            },
            icon(ICONS.close)
          )
        ),
        h("div", { class: "comment-body" }, comment.body),
        h(
          "div",
          { class: "row" },
          comment.status === "resolved"
            ? h(
                "span",
                { class: "badge badge-ok" },
                icon(ICONS.check),
                "Resolved"
              )
            : null,
          comment.page.origin !== location.origin
            ? h(
                "span",
                { class: "badge", title: `Left on ${comment.page.origin}` },
                new URL(comment.page.origin).host
              )
            : null,
          placement?.confidence === "low"
            ? h(
                "span",
                {
                  class: "badge",
                  title: "The page changed; this pin is a best guess",
                },
                "Approximate"
              )
            : null,
          !placement?.element
            ? h(
                "span",
                {
                  class: "badge",
                  title: `Originally on: ${comment.anchor.text || comment.anchor.tag}`,
                },
                "Element not found"
              )
            : null
        ),
        card.error
          ? h("div", { class: "error", role: "alert" }, card.error)
          : null
      )
    }

    const actions: Node[] = []
    if (!card.editing) {
      if (owner) {
        actions.push(
          comment.status === "open"
            ? h(
                "button",
                {
                  class: "btn",
                  type: "button",
                  disabled: Boolean(card.busy),
                  onclick: () => this.resolveComment(comment),
                },
                icon(ICONS.check),
                "Resolve"
              )
            : h(
                "button",
                {
                  class: "btn",
                  type: "button",
                  disabled: Boolean(card.busy),
                  onclick: () => this.reopenComment(comment),
                },
                icon(ICONS.undo),
                "Reopen"
              )
        )
      }
      actions.push(h("span", { class: "spacer" }))
      if (mine) {
        actions.push(
          h(
            "button",
            {
              class: "btn btn-ghost btn-icon",
              type: "button",
              "aria-label": "Edit",
              title: "Edit",
              onclick: () => {
                card.editing = true
                this.render()
              },
            },
            icon(ICONS.edit)
          )
        )
      }
      if (mine || owner) {
        actions.push(
          h(
            "button",
            {
              class: "btn btn-ghost btn-icon btn-danger",
              type: "button",
              "aria-label": "Delete",
              title: "Delete",
              disabled: Boolean(card.busy),
              onclick: () => this.deleteComment(comment),
            },
            icon(ICONS.trash)
          )
        )
      }
    }

    return h(
      "div",
      {
        class: cls,
        "data-card": "thread",
        role: "dialog",
        "aria-label": `Comment by ${comment.authorName}`,
      },
      body,
      actions.length > 1 || owner
        ? h("div", { class: "actions" }, ...actions)
        : null
    )
  }

  private positionCard() {
    const el = this.uiLayer.querySelector<HTMLElement>("[data-card]")
    if (!el || el.classList.contains("sheet")) return
    let point: { x: number; y: number } | null = null
    if (this.card?.kind === "composer") {
      const { draft } = this.card
      const r = draft.element.getBoundingClientRect()
      point = {
        x: r.left + draft.anchor.offset.x * r.width,
        y: r.top + draft.anchor.offset.y * r.height,
      }
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
      left = vw - width - 16
      top = vh - height - 72
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
