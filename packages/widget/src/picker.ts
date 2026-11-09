import {
  areaContainer,
  captureAnchor,
  captureArea,
  captureSelection,
  elementText,
  frameDocuments,
  isRendered,
  pickTarget,
  viewportRect,
  type Box,
} from "@nuni/anchor"
import { WIDGET_CLASS_PREFIX } from "@nuni/shared"

import { h, icon, isMobile, lineRects, placeBox, swallowClick } from "./dom"
import { ICONS } from "./icons"
import type { PinTarget } from "./pins"
import { isEditable } from "./privacy"
import type { Ctx } from "./widget"

const PICKING_CLASS = `${WIDGET_CLASS_PREFIX}picking`
const PICK_EVENTS = ["pointerdown", "mousedown", "pointerup", "mouseup"]
/** How far the pointer moves before a press becomes an area drag. */
const DRAG_THRESHOLD = 6
const PICK_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"]

export type Picker = ReturnType<typeof createPicker>

/**
 * Choosing what a comment is about: an element (by pointer or keyboard),
 * an area dragged on the page, or the page's selected text. While an owner
 * moves a pin, the pick goes to that comment instead of a new one.
 */
export function createPicker(ctx: Ctx) {
  let active = false
  /** The comment whose pin the owner is moving, while picking. */
  let repinId: string | null = null
  /** The page and its same-origin iframes, listened to while picking. */
  let docs: Document[] = []
  let hover: Element | null = null
  /** Where the pointer went down while picking, for area drags. */
  let dragStart: { x: number; y: number } | null = null
  let dragBox: Box | null = null
  /** The page's text selection, offered as a text comment. */
  let selection: Range | null = null
  let pointerDown = false
  let selectionFrame = 0
  const styles: HTMLStyleElement[] = []

  const picked = (target: PinTarget) => {
    const id = repinId
    set(false)
    if (id) void ctx.thread.movePin(id, target)
    else ctx.composer.open(target)
  }

  /**
   * The element the event happened on, inside open shadow roots too
   * (composedPath), and never Nuni's own UI.
   */
  const fromPage = (e: Event): Element | null => {
    const path = e.composedPath()
    if (path.includes(ctx.host)) return null
    const target = path[0] ?? e.target
    // nodeType, not instanceof: iframe elements come from another realm.
    return target && (target as Node).nodeType === 1
      ? (target as Element)
      : null
  }

  const hoverOn = (el: Element | null) => {
    hover = el
    renderHighlight()
  }

  /** Keep presses from the page while picking; a mouse drag draws an area. */
  const swallow = (e: Event) => {
    const target = fromPage(e)
    if (!target) return
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "pointerdown" && e instanceof PointerEvent) {
      hoverOn(pickTarget(target))
      // Not on touch, where dragging scrolls.
      dragStart =
        e.pointerType !== "touch" &&
        e.button === 0 &&
        target.ownerDocument === document
          ? { x: e.clientX, y: e.clientY }
          : null
    } else if (e.type === "pointerup") {
      const box = dragBox
      dragStart = dragBox = null
      if (box) {
        swallowClick(target.ownerDocument)
        picked(areaTarget(box))
      }
    }
  }

  const onMove = (e: PointerEvent) => {
    const start = dragStart
    if (start) {
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (dragBox || Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        dragBox = {
          left: Math.min(start.x, e.clientX),
          top: Math.min(start.y, e.clientY),
          width: Math.abs(dx),
          height: Math.abs(dy),
        }
        renderHighlight()
        return
      }
    }
    const target = fromPage(e)
    const next = target ? pickTarget(target) : null
    if (next !== hover) hoverOn(next)
  }

  const onClick = (e: MouseEvent) => {
    const target = fromPage(e)
    if (!target) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    const element = pickTarget(target)
    picked({
      anchor: captureAnchor(element, { x: e.clientX, y: e.clientY }),
      element,
    })
  }

  const onFrameKey = (e: KeyboardEvent) => ctx.onKeyDown(e)

  /** An area drawn while picking: anchored to the element that covers it. */
  const areaTarget = (box: Box): PinTarget => {
    const element = areaContainer(document, box)
    return { anchor: captureArea(element, box), element }
  }

  /** The page's selected text, if it can take a text comment. */
  const pageSelection = (): Range | null => {
    const sel = document.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null
    const range = sel.getRangeAt(0)
    const node = range.commonAncestorContainer
    const el = node.nodeType === 1 ? (node as Element) : node.parentElement
    if (!el || ctx.host.contains(el)) return null
    if (isEditable(el)) return null
    return range.toString().trim() ? range : null
  }

  const commentOnSelection = () => {
    const range = pageSelection()
    const captured = range && captureSelection(range)
    if (!range || !captured) return
    const kept = range.cloneRange()
    document.getSelection()?.removeAllRanges()
    selection = null
    picked({ ...captured, range: kept })
  }

  const scheduleSelection = () => {
    if (selectionFrame) return
    selectionFrame = requestAnimationFrame(() => {
      selectionFrame = 0
      selection = active || pointerDown ? null : pageSelection()
      placeSelectButton()
    })
  }

  /** A small "Comment" button under the selected text. */
  const button = h(
    "button",
    {
      class: "select-btn",
      type: "button",
      hidden: true,
      title: ctx.withKey("commentSelection", "commentSelectionKey"),
      // Keep the page's selection: a press would clear it.
      onmousedown: (e: Event) => e.preventDefault(),
      onpointerdown: (e: Event) => e.preventDefault(),
      onclick: commentOnSelection,
    },
    icon(ICONS.comment),
    ctx.t("comment")
  )

  const placeSelectButton = () => {
    const last = selection ? lineRects(selection).at(-1) : undefined
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (!last || last.bottom < 0 || last.top > vh) {
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

  const renderHighlight = () => {
    const overlay = ctx.overlayLayer
    overlay.replaceChildren()
    if (!active) return
    overlay.append(
      h(
        "div",
        { class: "pick-hint" },
        repinId
          ? ctx.t("movePinHint")
          : isMobile()
            ? ctx.t("pickHintMobile")
            : [
                h("span", {}, ctx.t("pickHint")),
                h("span", { class: "pick-keys" }, ctx.t("pickHintKeys")),
              ]
      )
    )
    if (dragBox) {
      const box = h("div", { class: "highlight drag-box" })
      placeBox(box, dragBox)
      overlay.append(box)
      return
    }
    const el = hover
    if (!el || el === el.ownerDocument.documentElement) return
    const r = viewportRect(el, document)
    const box = h(
      "div",
      { class: "highlight" },
      h("span", { class: "highlight-label" }, describeElement(el))
    )
    placeBox(box, {
      left: r.left - 2,
      top: r.top - 2,
      width: r.width + 4,
      height: r.height + 4,
    })
    overlay.append(box)
  }

  /** Keyboard picking starts at the focused element, or mid-screen. */
  const keyboardStart = (): Element => {
    const focused = document.activeElement
    if (focused && focused !== document.body && focused !== ctx.host) {
      return focused
    }
    const middle = document
      .elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      .find((el) => !ctx.host.contains(el))
    return middle ? pickTarget(middle) : document.body
  }

  const moveTo = (el: Element) => {
    el.scrollIntoView({ block: "nearest", inline: "nearest" })
    ctx.announce(ctx.t("picked", { element: describeElement(el) }))
    hoverOn(el)
  }

  const listen = (doc: Document, on: boolean) => {
    const method = on ? "addEventListener" : "removeEventListener"
    doc.documentElement?.classList.toggle(PICKING_CLASS, on)
    doc[method]("pointermove", onMove as EventListener, true)
    doc[method]("click", onClick as EventListener, true)
    // Not touchstart: cancelling it would also cancel the tap's click.
    for (const type of PICK_EVENTS) {
      doc[method](type, swallow, { capture: true, passive: false })
    }
    if (doc !== document) {
      doc[method]("keydown", onFrameKey as EventListener, true)
    }
  }

  const set = (on: boolean) => {
    if (!on) repinId = null
    if (active === on) return
    active = on
    dragStart = dragBox = null
    if (on) {
      ctx.closeCard()
      // Adding a comment shows the others again, like Figma.
      ctx.pins.setHidden(false, true)
      if (isMobile()) ctx.panel.toggle(false)
      // The page and its same-origin iframes: anything in them can be picked.
      docs = [document, ...frameDocuments(document)]
      for (const doc of docs) {
        injectCursorStyle(doc)
        listen(doc, true)
      }
    } else {
      hover = null
      for (const doc of docs) listen(doc, false)
      docs = []
    }
    ctx.render()
  }

  const injectCursorStyle = (doc: Document) => {
    if (doc.getElementById("nuni-cursor-style")) return
    const style = doc.createElement("style")
    style.id = "nuni-cursor-style"
    style.textContent = `html.${PICKING_CLASS}, html.${PICKING_CLASS} * { cursor: crosshair !important; }`
    ;(doc.head ?? doc.documentElement).appendChild(style)
    styles.push(style)
  }

  return {
    button,

    get active() {
      return active
    },

    set,

    /** The owner picks the element a comment is about now. */
    repin(id: string) {
      set(true)
      repinId = id
      ctx.render()
    },

    /** The hotkey: comment on the selected text, or start or stop picking. */
    toggle() {
      if (!active && pageSelection()) commentOnSelection()
      else set(!active)
    },

    start() {
      const onDown = (e: PointerEvent) => {
        if (e.composedPath().includes(ctx.host)) return
        pointerDown = true
        scheduleSelection()
      }
      const onUp = () => {
        pointerDown = false
        scheduleSelection()
      }
      document.addEventListener("selectionchange", scheduleSelection)
      document.addEventListener("pointerdown", onDown, true)
      document.addEventListener("pointerup", onUp, true)
      return () => {
        document.removeEventListener("selectionchange", scheduleSelection)
        document.removeEventListener("pointerdown", onDown, true)
        document.removeEventListener("pointerup", onUp, true)
        cancelAnimationFrame(selectionFrame)
        set(false)
        for (const style of styles) style.remove()
      }
    },

    /** On every layout: the highlight and the selection button follow the page. */
    layout() {
      renderHighlight()
      placeSelectButton()
    },

    /**
     * Picking without a mouse: arrows move to the parent, first child and
     * siblings; Enter comments on the highlighted element. True when the
     * key was used.
     */
    onKey(e: KeyboardEvent): boolean {
      if (!PICK_KEYS.includes(e.key)) return false
      e.preventDefault()
      e.stopPropagation()
      let el = hover
      if (!el || !el.isConnected) {
        moveTo(keyboardStart())
        return true
      }
      if (e.key === "Enter") {
        const r = el.getBoundingClientRect()
        picked({
          anchor: captureAnchor(el, {
            x: r.left + r.width / 2,
            y: r.top + r.height / 2,
          }),
          element: el,
        })
        return true
      }
      const next = (n: Element | null) => {
        while (n && (ctx.host.contains(n) || !isRendered(n))) {
          n =
            e.key === "ArrowLeft"
              ? n.previousElementSibling
              : n.nextElementSibling
        }
        return n
      }
      if (e.key === "ArrowUp") {
        if (el.parentElement && el !== el.ownerDocument.body) {
          el = el.parentElement
        }
      } else if (e.key === "ArrowDown") {
        el = next(el.firstElementChild) ?? el
      } else if (e.key === "ArrowLeft") {
        el = next(el.previousElementSibling) ?? el
      } else {
        el = next(el.nextElementSibling) ?? el
      }
      moveTo(el)
      return true
    },
  }
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

export const PICKER_CSS = /* css */ `
.pick-hint {
  display: flex;
  gap: 8px;
  align-items: center;
  max-width: calc(100vw - 24px);
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--n-fg);
  color: var(--n-bg);
  font-size: 13px;
  box-shadow: var(--n-shadow);
  pointer-events: none;
}
.highlight {
  position: fixed;
  border: 2px solid var(--n-accent);
  background: var(--n-accent-soft);
  border-radius: 4px;
  pointer-events: none;
  transition: all 60ms ease-out;
}
.highlight-label {
  position: absolute;
  left: -2px;
  bottom: 100%;
  margin-bottom: 4px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--n-accent);
  color: var(--n-accent-fg);
  font: 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drag-box { transition: none; border-style: dashed; }

.select-btn {
  position: fixed;
  left: 0;
  top: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: var(--n-fg);
  color: var(--n-bg);
  font-weight: 550;
  font-size: 13px;
  box-shadow: var(--n-shadow);
  pointer-events: auto;
}
.select-btn[hidden] { display: none; }

.pick-keys { opacity: 0.7; }
.pick-keys::before { content: "·"; margin-right: 8px; }
@media (max-width: 900px) { .pick-keys { display: none; } }
`
