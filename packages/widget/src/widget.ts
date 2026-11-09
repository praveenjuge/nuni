import { WIDGET_ATTRIBUTE } from "@nuni/shared"

import { failureCode, NuniApi } from "./api"
import { createComposer, type Composer, type Draft } from "./composer"
import type { ResolvedConfig } from "./config"
import type { Collectors } from "./context"
import { createDialog, type Dialog } from "./dialog"
import { h, isMobile, parseColor, readableOn } from "./dom"
import { createI18n, type I18n, type MessageKey } from "./i18n"
import { createIdentity, type Identity } from "./identity"
import type { Runtime } from "./mount"
import { createPage, type Page } from "./page"
import { createPanel, type Panel } from "./panel"
import { createPicker, type Picker } from "./picker"
import { createPins, type Pins } from "./pins"
import { isEditable } from "./privacy"
import { STYLES } from "./styles"
import { createThread, type ThreadCard, type ThreadCards } from "./thread"
import { createToolbar, type Toolbar } from "./toolbar"

export interface WidgetRuntime extends Runtime {
  collectors: Collectors
}

/** The open card: a comment being written, or an open comment. */
export type Card = { kind: "composer"; draft: Draft } | ThreadCard | null

/** A card sits right of its pin (28px wide, see `.pin`), level with its top. */
const CARD_OFFSET_X = 36
const CARD_OFFSET_Y = -28
/** Without a pin, a card sits next to the toolbar in its corner. */
const TOOLBAR_EDGE = 16
const TOOLBAR_CLEARANCE = 72
const VIEWPORT_MARGIN = 12

/**
 * What the widget's parts share: the options, the connection to Nuni,
 * words, the layers they draw in, the open card and each other.
 */
export interface Ctx {
  config: ResolvedConfig
  runtime: WidgetRuntime
  api: NuniApi
  i18n: I18n
  t: I18n["t"]
  /** A message that names the hotkey, or the plain one when it is off. */
  withKey(plain: MessageKey, keyed: MessageKey): string
  /** What to tell the visitor about an action that failed with `error`. */
  failed(
    error: unknown,
    action: MessageKey,
    overrides?: Record<string, MessageKey>
  ): string
  host: HTMLElement
  root: ShadowRoot
  /** Toolbar, panel, card, toast and dialog: rebuilt on every render. */
  ui: HTMLDivElement
  markLayer: HTMLDivElement
  pinLayer: HTMLDivElement
  overlayLayer: HTMLDivElement
  /** Full-screen editors (marking up a screenshot), kept out of render. */
  modalLayer: HTMLDivElement
  readonly card: Card
  /** The comment whose card is open. */
  readonly activeId: string | null
  /** Open a card (or none), after the old one's cleanup. */
  setCard(next: Card): void
  /** The visitor closes the card: focus goes back to where it was. */
  closeCard(): void
  positionCard(): void
  /** Run once the next render has put the new UI in place. */
  afterRender(fn: () => void): void
  render(): void
  toast(message: string): void
  /** Tell screen readers. */
  announce(text: string): void
  onKeyDown(e: KeyboardEvent): void
  identity: Identity
  dialog: Dialog
  page: Page
  pins: Pins
  picker: Picker
  composer: Composer
  thread: ThreadCards
  panel: Panel
  toolbar: Toolbar
}

/**
 * The widget's shell: the host element and its layers, page-wide events,
 * the open card and rendering. Each part lives in its own module.
 */
export class NuniWidget {
  private ctx: Ctx
  private cleanups: (() => void)[] = []

  constructor(config: ResolvedConfig, runtime: WidgetRuntime) {
    const host = document.createElement("div")
    host.id = "nuni-root"
    host.setAttribute(WIDGET_ATTRIBUTE, "")
    const root = host.attachShadow({ mode: "open" })
    const layer = (cls: string) => h("div", { class: cls })
    const markLayer = h("div", { class: "marks", "aria-hidden": "true" })
    const pinLayer = layer("pins")
    const overlayLayer = layer("overlay")
    const ui = layer("ui")
    const modalLayer = layer("modal")
    const live = h("div", {
      class: "sr",
      role: "status",
      "aria-live": "polite",
    })
    const i18n = createI18n(config.locale, config.messages)
    let card: Card = null
    let activeId: string | null = null
    let after: (() => void)[] = []

    const render = () => {
      ctx.thread.sync()
      ctx.panel.sync()
      ctx.pins.render()
      const nodes: Node[] = [ctx.toolbar.render()]
      if (ctx.panel.open) nodes.push(ctx.panel.render())
      const cls = `card${isMobile() ? " sheet" : ""}`
      const cardNode =
        card?.kind === "composer"
          ? ctx.composer.render(card.draft, cls)
          : card
            ? ctx.thread.render(card, cls)
            : null
      if (cardNode) nodes.push(cardNode)
      ctx.pins.drawn()
      ctx.dialog.replaceUi(nodes)
      const done = after
      after = []
      for (const fn of done) fn()
      ctx.pins.layout()
    }

    const setCard = (next: Card) => {
      if (card?.kind === "composer" && card !== next) {
        ctx.composer.discard(card.draft)
      }
      card = next
      activeId = next?.kind === "thread" ? next.id : null
      render()
    }

    // The parts are added below; each one only reaches the others once running.
    const ctx: Ctx = {
      config,
      runtime,
      api: new NuniApi(config, (code) =>
        ctx.toast(i18n.failed(code, "failed"))
      ),
      i18n,
      t: i18n.t,
      withKey: (plain, keyed) => {
        const key = config.hotkey
        return key ? i18n.t(keyed, { key: key.toUpperCase() }) : i18n.t(plain)
      },
      failed: (error, action, overrides) =>
        i18n.failed(failureCode(error), action, overrides),
      host,
      root,
      ui,
      markLayer,
      pinLayer,
      overlayLayer,
      modalLayer,
      get card() {
        return card
      },
      get activeId() {
        return activeId
      },
      setCard,
      closeCard: () => {
        const had = card !== null
        setCard(null)
        if (had && !ctx.panel.open) ctx.dialog.restoreFocus()
      },
      positionCard: () => positionCard(ctx),
      afterRender: (fn) => after.push(fn),
      render,
      toast: (message) => ctx.dialog.toast(message),
      announce: (text) => (live.textContent = text),
      onKeyDown: (e) => onKeyDown(ctx, e),
    } as Partial<Ctx> as Ctx
    ctx.identity = createIdentity(ctx)
    ctx.dialog = createDialog(ctx)
    ctx.page = createPage(ctx)
    ctx.pins = createPins(ctx)
    ctx.picker = createPicker(ctx)
    ctx.composer = createComposer(ctx)
    ctx.thread = createThread(ctx)
    ctx.panel = createPanel(ctx)
    ctx.toolbar = createToolbar(ctx)
    this.ctx = ctx

    applyAppearance(host, config)
    root.append(
      h("style", {}, STYLES),
      markLayer,
      pinLayer,
      overlayLayer,
      ui,
      modalLayer,
      ctx.picker.button,
      live
    )
    ui.addEventListener("keydown", (e) => ctx.dialog.trapFocus(e))
  }

  start() {
    const { ctx } = this
    document.body.appendChild(ctx.host)
    ctx.identity.start()
    ctx.panel.start()
    ctx.pins.start()
    this.cleanups.push(ctx.picker.start(), ctx.page.start())

    const onKey = (e: KeyboardEvent) => ctx.onKeyDown(e)
    const onMessage = (e: MessageEvent) => ctx.identity.onMessage(e)
    const onDown = (e: PointerEvent) => closeFromOutside(ctx, e)
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("message", onMessage)
    document.addEventListener("pointerdown", onDown, true)
    this.cleanups.push(() => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("message", onMessage)
      document.removeEventListener("pointerdown", onDown, true)
    })
    ctx.render()
  }

  destroy() {
    const { ctx } = this
    for (const cleanup of this.cleanups) cleanup()
    ctx.toolbar.stop()
    ctx.pins.stop()
    ctx.dialog.stop()
    ctx.host.remove()
    void ctx.api.close()
  }
}

/** Position, theme, brand color and stacking order from the options. */
function applyAppearance(host: HTMLElement, config: ResolvedConfig) {
  const { theme, accentColor, zIndex } = config
  host.dataset.theme = theme
  if (zIndex !== null) host.style.zIndex = String(zIndex)
  const rgb = accentColor ? parseColor(accentColor) : null
  if (!rgb) return
  const [r, g, b] = rgb
  host.style.setProperty("--n-accent", `rgb(${r}, ${g}, ${b})`)
  host.style.setProperty("--n-accent-soft", `rgba(${r}, ${g}, ${b}, 0.14)`)
  host.style.setProperty("--n-accent-fg", readableOn(rgb))
}

/** The screenshot editor is open: it handles keys and presses. */
function editorOpen(ctx: Ctx) {
  return ctx.modalLayer.childElementCount > 0
}

function onKeyDown(ctx: Ctx, e: KeyboardEvent) {
  if (editorOpen(ctx)) return
  const { dialog, picker, pins } = ctx
  const inWidget = e.composedPath().includes(ctx.host)
  if (e.key === "Escape") {
    if (dialog.asking) dialog.answer(false)
    else if (picker.active) picker.set(false)
    else if (ctx.card) ctx.closeCard()
    else if (!ctx.panel.escape()) return
    e.stopPropagation()
    return
  }
  // The real target, inside the widget's shadow root too.
  const target = e.composedPath()[0] ?? e.target
  if (isEditable(target) || e.metaKey || e.ctrlKey || e.altKey) return
  // Arrows and Enter on the widget's own buttons keep their meaning.
  if (picker.active && !inWidget && picker.onKey(e)) return
  if ((inWidget && dialog.asking) || e.repeat) return
  const hotkey = ctx.config.hotkey
  if (hotkey && e.key.toLowerCase() === hotkey) {
    e.preventDefault()
    // Shift and the hotkey hides or shows the pins, like Figma's Shift+C.
    if (e.shiftKey) pins.setHidden(!pins.hidden)
    else picker.toggle()
  }
}

/**
 * A press on the page closes the open card, like Figma, unless the card
 * holds words or images that haven't been sent yet.
 */
function closeFromOutside(ctx: Ctx, e: PointerEvent) {
  const card = ctx.card
  if (e.composedPath().includes(ctx.host)) return
  if (!card || ctx.picker.active || ctx.dialog.asking || !e.isPrimary) return
  if (editorOpen(ctx) || onScrollbar(e)) return
  const unsent =
    card.kind === "composer"
      ? ctx.composer.unsent(card.draft)
      : ctx.thread.unsent(card)
  if (unsent) return
  // Focus goes where they pressed, not back to where it was.
  if (!ctx.panel.open) ctx.dialog.dropFocus()
  ctx.closeCard()
}

function positionCard(ctx: Ctx) {
  const el = ctx.ui.querySelector<HTMLElement>("[data-card]")
  if (!el || el.classList.contains("sheet")) return
  const card = ctx.card
  let point: { x: number; y: number } | null = null
  if (card?.kind === "composer") {
    point = ctx.pins.anchorPoint(card.draft)
  } else if (card) {
    const comment = ctx.page.comments.find((c) => c._id === card.id)
    point = comment ? ctx.pins.cardPoint(comment) : null
  }
  const width = el.offsetWidth || 320
  const height = el.offsetHeight || 160
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left: number
  let top: number
  if (point) {
    left = point.x + CARD_OFFSET_X
    top = point.y + CARD_OFFSET_Y
    if (left + width > vw - VIEWPORT_MARGIN) {
      left = point.x - width - VIEWPORT_MARGIN
    }
  } else {
    const position = ctx.toolbar.position
    left = position.endsWith("left")
      ? TOOLBAR_EDGE
      : position.endsWith("center")
        ? (vw - width) / 2
        : vw - width - TOOLBAR_EDGE
    top = position.startsWith("top")
      ? TOOLBAR_CLEARANCE
      : vh - height - TOOLBAR_CLEARANCE
  }
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - width - VIEWPORT_MARGIN))
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - height - VIEWPORT_MARGIN))
  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
}

/** A press on a scrollbar, which scrolls rather than points at the page. */
function onScrollbar(e: PointerEvent): boolean {
  const el = e.composedPath()[0]
  if (!(el instanceof Element)) return false
  const root = document.documentElement
  if (el === root)
    return e.clientX >= root.clientWidth || e.clientY >= root.clientHeight
  const scrolls =
    el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth
  if (!scrolls) return false
  const box = el.getBoundingClientRect()
  return (
    e.clientX - box.left - el.clientLeft >= el.clientWidth ||
    e.clientY - box.top - el.clientTop >= el.clientHeight
  )
}
