import {
  createResolveCache,
  isRendered,
  resolveAnchor,
  scopeChain,
  stillMatches,
  viewportRect,
  type Box,
  type Confidence,
  type ScopeRoot,
} from "@nuni/anchor"
import { LIMITS, type Anchor, type WidgetComment } from "@nuni/shared"

import { colorFor, h, initials, lineRects, placeBox, whenIdle } from "./dom"
import { scrollToPin } from "./scroll-to-pin"
import { KEYS, read, write } from "./storage"
import type { Ctx } from "./widget"

/** Where a comment's pin goes, as last found on the page. */
interface Placement {
  element: Element | null
  confidence: Confidence
  /** A text comment's words, when they were found. */
  range?: Range
}

/** What a new pin points at: an element, and the words of a text comment. */
export interface PinTarget {
  anchor: Anchor
  element: Element
  range?: Range
}

type Point = { x: number; y: number }

/** A pin's width and height on large screens. */
export const PIN_SIZE = 28
/** Pins closer than half a pin fan out, overlapping a little. */
const PIN_OVERLAP = PIN_SIZE / 2
const PIN_FAN_STEP = 18
/** DOM changes come in bursts; pins are found again once they pause. */
const RESOLVE_DELAY_MS = 200
/** Each pass of finding pins yields to the page after this long. */
const RESOLVE_SLICE_MS = 8
/** How long pins have to stay settled before lost ones are reported. */
const REPORT_DELAY_MS = 3000
/** Page changes that can move or hide a pin's element. */
const OBSERVE: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["class", "style", "hidden", "open", "id"],
}

export type Pins = ReturnType<typeof createPins>

/**
 * The pins: finding each comment's element on the page (and again as the
 * page changes), drawing the pins and text marks, and reporting the ones
 * that are lost.
 */
export function createPins(ctx: Ctx) {
  const { config } = ctx
  const placements = new Map<string, Placement>()
  const buttons = new Map<string, HTMLButtonElement>()
  const positions = new Map<string, Point>()
  /** Lost (true) or found (false), as last reported in this page view. */
  const reported = new Map<string, boolean>()
  /** Shadow roots and iframes holding pins, watched for changes. */
  const scopes = new Map<ScopeRoot, () => void>()
  /** The visitor hid the pins (Shift+C); remembered for this project. */
  let hidden = read(KEYS.hidden(config.project)) === "1"
  /** Bumped by every resolve pass, so an older sliced pass stops. */
  let run = 0
  let resolveTimer = 0
  let reportTimer = 0
  let layoutFrame = 0
  /** The placements the panel and cards were last drawn with. */
  let shown = ""
  const stops: (() => void)[] = []

  /** The open thread keeps its pin while the rest are hidden. */
  const visible = () => {
    const card = ctx.card
    const status = ctx.panel.showsResolved ? "resolved" : "open"
    return ctx.page.comments.filter(
      (c) =>
        (!hidden && c.status === status) ||
        (card?.kind === "thread" && card.id === c._id)
    )
  }

  const scheduleLayout = () => {
    if (layoutFrame) return
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0
      ctx.layout()
    })
  }

  const scheduleResolve = () => {
    clearTimeout(resolveTimer)
    resolveTimer = window.setTimeout(() => resolve(true), RESOLVE_DELAY_MS)
  }

  /**
   * Find pins again when `root` changes, and move them when it scrolls.
   * Changes inside a shadow root or an iframe, and its scrolling, don't
   * reach the page's own observers.
   */
  const watch = (root: ScopeRoot) => {
    const doc = root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : null
    const observer = new MutationObserver((records) => {
      // Nuni's own UI changes on every render.
      if (!records.every((r) => ctx.host.contains(r.target))) {
        scheduleResolve()
      }
    })
    observer.observe(doc ? (doc.body ?? doc.documentElement) : root, OBSERVE)
    const target: EventTarget = doc?.defaultView ?? root
    target.addEventListener("scroll", scheduleLayout, {
      capture: true,
      passive: true,
    })
    doc?.defaultView?.addEventListener("resize", scheduleLayout, {
      passive: true,
    })
    return () => {
      observer.disconnect()
      target.removeEventListener("scroll", scheduleLayout, true)
      doc?.defaultView?.removeEventListener("resize", scheduleLayout)
    }
  }

  const watchScopes = () => {
    const roots = new Set<ScopeRoot>()
    for (const { element } of placements.values()) {
      for (const step of element ? scopeChain(element) : [])
        roots.add(step.root)
    }
    for (const [root, stop] of scopes) {
      if (!roots.has(root)) {
        stop()
        scopes.delete(root)
      }
    }
    for (const root of roots) {
      if (!scopes.has(root)) scopes.set(root, watch(root))
    }
  }

  /** What the panel and cards show from the placements: found, approximate or lost. */
  const summary = () =>
    ctx.page.comments
      .map((c) => {
        const placement = placements.get(c._id)
        if (!placement?.element) return "-"
        return placement.confidence === "low" ? "~" : "+"
      })
      .join("")

  /**
   * Once the pins have settled for a few seconds, report the ones that
   * couldn't be found (or were found again), so the owner sees them in the
   * dashboard. Only changes are sent.
   */
  const scheduleReport = () => {
    clearTimeout(reportTimer)
    reportTimer = window.setTimeout(() => {
      const { page } = ctx
      if (!page.loaded || document.visibilityState !== "visible") return
      const lost: string[] = []
      const found: string[] = []
      for (const c of page.comments) {
        if (c.status !== "open" || c.page.path !== page.key) continue
        const placement = placements.get(c._id)
        if (!placement) continue
        const isLost = !placement.element
        if (isLost === (reported.get(c._id) ?? Boolean(c.pinLost))) continue
        if (lost.length + found.length >= LIMITS.pinReportMax) break
        reported.set(c._id, isLost)
        ;(isLost ? lost : found).push(c._id)
      }
      if (lost.length || found.length) ctx.api.reportPins(page.key, lost, found)
    }, REPORT_DELAY_MS)
  }

  /**
   * Find each comment's element. With `onlyStale`, keep placements whose
   * element is still attached and still looks like what was captured.
   * Works in slices, so a page with many pins stays responsive; `first`
   * (a comment being opened) is found right away.
   */
  const resolve = (onlyStale: boolean, first?: string) => {
    const pass = ++run
    const comments = ctx.page.comments
    const ids = new Set(comments.map((c) => c._id))
    for (const id of placements.keys()) {
      if (!ids.has(id)) placements.delete(id)
    }
    const queue = comments.filter(
      (c) =>
        !(
          onlyStale &&
          stillMatches(c.anchor, placements.get(c._id) ?? { element: null })
        )
    )
    const index = first ? queue.findIndex((c) => c._id === first) : -1
    if (index > 0) queue.unshift(...queue.splice(index, 1))
    // One cache per pass: lookups are shared by every pin on the page.
    const options = { cache: createResolveCache() }

    const slice = () => {
      if (pass !== run) return
      const started = performance.now()
      while (queue.length) {
        const comment = queue.shift()!
        const result = resolveAnchor(comment.anchor, options)
        placements.set(comment._id, {
          element: result.element,
          confidence: result.confidence,
          range: result.range,
        })
        if (performance.now() - started > RESOLVE_SLICE_MS) break
      }
      watchScopes()
      render()
      ctx.layout()
      if (queue.length) {
        whenIdle(slice, 100)
        return
      }
      scheduleReport()
      // Rebuilding the panel on every page change would swallow clicks on
      // pages that keep re-rendering, so only redraw when it would change.
      if ((onlyStale || pass > 1) && ctx.panel.open && summary() !== shown) {
        ctx.render()
      }
    }
    slice()
  }

  /**
   * Where a pin goes: after the last selected word for a text comment, the
   * top-right corner of an area, or where the element was clicked.
   */
  const anchorPoint = ({ anchor, element, range }: PinTarget): Point => {
    if (range && range.startContainer.ownerDocument === document) {
      const last = lineRects(range).at(-1)
      if (last) return { x: last.right, y: last.top + last.height / 2 }
    }
    const r = viewportRect(element, document)
    return {
      x: r.left + anchor.offset.x * r.width,
      y: r.top + anchor.offset.y * r.height,
    }
  }

  const target = (comment: WidgetComment): PinTarget | null => {
    const placement = placements.get(comment._id)
    return placement?.element
      ? { ...placement, anchor: comment.anchor, element: placement.element }
      : null
  }

  /** On screen, in the page's viewport, or null when it can't be seen. */
  const pinPoint = (comment: WidgetComment): Point | null => {
    const at = target(comment)
    if (!at || !isRendered(at.element)) return null
    if (viewportRect(at.element, document).clipped) return null
    return anchorPoint(at)
  }

  /**
   * Text comments underline their words, and the open comment (or the one
   * being written) also shows its words or its area strongly.
   */
  const renderMarks = () => {
    const marks: HTMLElement[] = []
    const add = (box: Box, cls: string) => {
      const mark = h("div", { class: cls })
      placeBox(mark, box)
      marks.push(mark)
    }
    const show = (at: PinTarget | null, active: boolean) => {
      if (!at) return
      if (at.range && at.range.startContainer.ownerDocument === document) {
        for (const r of lineRects(at.range)) {
          add(r, active ? "mark mark-active" : "mark")
        }
      }
      const box = active ? regionBox(at.anchor, at.element) : null
      if (box) add(box, "area")
    }
    const card = ctx.card
    if (card?.kind === "composer") show(card.draft, true)
    for (const comment of visible()) {
      const active = ctx.activeId === comment._id
      if (!active && (comment.status !== "open" || !comment.anchor.quote)) {
        continue
      }
      if (buttons.get(comment._id)?.hidden) continue
      show(target(comment), active)
    }
    ctx.markLayer.replaceChildren(...marks)
  }

  const layout = () => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const taken: Point[] = []
    positions.clear()
    for (const comment of visible()) {
      const pin = buttons.get(comment._id)
      if (!pin) continue
      const point = pinPoint(comment)
      pin.hidden = !(
        point &&
        point.x >= -10 &&
        point.y >= -10 &&
        point.x <= vw + 10 &&
        point.y <= vh + 10
      )
      if (!point) continue
      // Fan out pins that land on the same spot so each stays clickable.
      const y = point.y
      let x = point.x
      while (
        taken.some(
          (t) =>
            Math.abs(t.x - x) < PIN_OVERLAP && Math.abs(t.y - y) < PIN_OVERLAP
        )
      )
        x += PIN_FAN_STEP
      taken.push({ x, y })
      positions.set(comment._id, { x, y })
      pin.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    }
    renderMarks()
  }

  const render = () => {
    const shownNow = visible()
    const keep = new Set(shownNow.map((c) => c._id))
    for (const [id, pin] of buttons) {
      if (!keep.has(id)) {
        pin.remove()
        buttons.delete(id)
      }
    }
    for (const comment of shownNow) {
      const id = comment._id
      let pin = buttons.get(id)
      if (!pin) {
        pin = h("button", { class: "pin", type: "button", hidden: true })
        pin.addEventListener("click", (e) => {
          e.stopPropagation()
          const card = ctx.card
          if (card?.kind === "thread" && card.id === id) ctx.closeCard()
          else ctx.thread.open(id)
        })
        buttons.set(id, pin)
        ctx.pinLayer.append(pin)
      }
      pin.textContent = initials(comment.authorName)
      pin.style.background = colorFor(comment.authorName)
      pin.setAttribute(
        "aria-label",
        ctx.t("pinLabel", {
          name: comment.authorName,
          body: (comment.body || comment.suggestion?.after || "").slice(0, 80),
        })
      )
      if (comment.replyCount) pin.dataset.replies = String(comment.replyCount)
      else delete pin.dataset.replies
      pin.dataset.status = comment.status
      pin.dataset.active = String(ctx.activeId === id)
      pin.dataset.confidence = placements.get(id)?.confidence ?? "lost"
    }
    // The pin of the comment being written.
    ctx.pinLayer.querySelector(".pin-draft")?.remove()
    const card = ctx.card
    if (card?.kind === "composer") {
      const { x, y } = anchorPoint(card.draft)
      const name = ctx.identity.nameFor(false)
      const pin = h(
        "div",
        { class: "pin pin-draft pin-pending", "aria-hidden": "true" },
        name ? initials(name) : "+"
      )
      pin.style.background = name ? colorFor(name) : "var(--n-accent)"
      pin.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
      ctx.pinLayer.append(pin)
    }
  }

  return {
    get hidden() {
      return hidden
    },

    /** Hide or show the pins, like Figma's Shift+C. */
    setHidden(on: boolean, quiet = false) {
      if (hidden === on) return
      hidden = on
      write(KEYS.hidden(config.project), on ? "1" : null)
      if (quiet) ctx.render()
      else {
        ctx.toast(
          on
            ? ctx.withKey("commentsHidden", "commentsHiddenKey")
            : ctx.t("commentsShown")
        )
      }
    },

    start() {
      stops.push(watch(document))
      const resize = new ResizeObserver(scheduleLayout)
      resize.observe(document.documentElement)
      stops.push(() => resize.disconnect())
    },

    stop() {
      run++
      clearTimeout(resolveTimer)
      clearTimeout(reportTimer)
      cancelAnimationFrame(layoutFrame)
      for (const stop of [...stops, ...scopes.values()]) stop()
      scopes.clear()
    },

    /** A new page: nothing is placed or reported yet. */
    reset() {
      placements.clear()
      reported.clear()
      clearTimeout(reportTimer)
    },

    found(id: string) {
      return placements.get(id)?.element ?? null
    },

    confidence(id: string) {
      return placements.get(id)?.confidence
    },

    /**
     * Show a pin exactly where it was dropped until the comment syncs (a
     * new comment, a moved pin). Returns how to undo it.
     */
    place(id: string, at: PinTarget) {
      const previous = placements.get(id)
      placements.set(id, { ...at, confidence: "exact" })
      reported.set(id, false)
      return () => {
        if (previous) placements.set(id, previous)
        else placements.delete(id)
      }
    },

    /** The UI was drawn with the current placements. */
    drawn() {
      shown = summary()
    },

    resolve,

    /** The comments changed: find new pins, keep the ones that still fit. */
    refresh(first?: string) {
      resolve(placements.size > 0, first)
    },

    render,
    /** Put the pins and marks where their elements are: see `ctx.layout`. */
    layout,
    scheduleLayout,
    scheduleResolve,
    anchorPoint,

    /** Where the card of an open comment points. */
    cardPoint(comment: WidgetComment): Point | null {
      return positions.get(comment._id) ?? pinPoint(comment)
    },

    /** Scroll the page (and scroll boxes and frames) to a comment's pin. */
    scrollTo(comment: WidgetComment) {
      const at = target(comment)
      if (at) scrollToPin(at.element, () => anchorPoint(at))
    },
  }
}

/** An area comment's box on screen, from its element's box. */
export function regionBox(anchor: Anchor, el: Element): Box | null {
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

export const PINS_CSS = /* css */ `
.pin {
  position: fixed;
  left: 0;
  top: 0;
  width: ${PIN_SIZE}px;
  height: ${PIN_SIZE}px;
  margin: -${PIN_SIZE}px 0 0 0;
  border: 2px solid #fff;
  border-radius: 14px 14px 14px 2px;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  pointer-events: auto;
  cursor: pointer;
  transition: transform 120ms ease;
  will-change: transform;
}
.pin:hover, .pin[data-active="true"] { z-index: 2; }
.pin[data-active="true"] { box-shadow: 0 0 0 3px var(--n-accent), 0 2px 8px rgba(0,0,0,0.25); }
.pin[data-status="resolved"] { opacity: 0.55; filter: grayscale(0.6); }
.pin[data-replies]::after {
  content: attr(data-replies);
  position: absolute;
  top: -6px;
  right: -8px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--n-bg);
  color: var(--n-fg);
  border: 1px solid var(--n-border);
  font-size: 10px;
  line-height: 14px;
  text-align: center;
}
.pin[data-confidence="low"] { border-style: dashed; }
.pin[hidden] { display: none; }
.pin-pending { opacity: 0.7; }

.marks { position: fixed; inset: 0; pointer-events: none; }
.mark {
  position: fixed;
  border-bottom: 2px solid var(--n-accent);
  background: var(--n-accent-soft);
  opacity: 0.7;
  pointer-events: none;
}
.mark-active { opacity: 1; background: color-mix(in srgb, var(--n-accent) 26%, transparent); }
.area {
  position: fixed;
  border: 2px dashed var(--n-accent);
  border-radius: 4px;
  background: var(--n-accent-soft);
  pointer-events: none;
}
`
