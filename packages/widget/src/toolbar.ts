import { oneOf, POSITIONS, type Position } from "./config"
import { h, icon, swallowClick } from "./dom"
import { ICONS } from "./icons"
import { KEYS, read, write } from "./storage"
import type { Ctx } from "./widget"

/** How far the pointer moves before a press on the toolbar becomes a drag. */
const DRAG_THRESHOLD = 5

/** A press on the toolbar: the pointer, where it started and how far it went. */
interface Drag {
  id: number
  x: number
  y: number
  dx: number
  dy: number
  moving: boolean
}

export type Toolbar = ReturnType<typeof createToolbar>

/**
 * The toolbar: add a comment, the comments list, hide the pins. Visitors
 * drag it anywhere; on release it glides to the nearest corner or edge
 * middle, which is remembered for this visitor.
 */
export function createToolbar(ctx: Ctx) {
  const { config, host } = ctx
  /** Where the toolbar sits: where this visitor dragged it, or the option. */
  let position: Position = oneOf(
    read(KEYS.position(config.project)) ?? undefined,
    POSITIONS,
    config.position
  )
  host.dataset.position = position
  let drag: Drag | null = null
  let endDrag: (() => void) | null = null

  const element = () => ctx.ui.querySelector<HTMLElement>(".toolbar")

  /** Glide the toolbar to the spot nearest where it was let go, or back. */
  const drop = (el: HTMLElement | null, snap: boolean) => {
    swallowClick(ctx.root)
    if (!el) return
    const from = el.getBoundingClientRect()
    if (snap) {
      position = nearestPosition(
        from.left + from.width / 2,
        from.top + from.height / 2
      )
      host.dataset.position = position
      write(
        KEYS.position(config.project),
        position === config.position ? null : position
      )
    }
    el.removeAttribute("data-dragging")
    el.style.removeProperty("transform")
    const to = el.getBoundingClientRect()
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
    el.animate(
      [
        {
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`,
        },
        { transform: "none" },
      ],
      { duration: 320, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.15)" }
    )
  }

  const startDrag = (e: PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return
    endDrag?.()
    const press: Drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      dx: 0,
      dy: 0,
      moving: false,
    }
    drag = press
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== press.id) return
      press.dx = ev.clientX - press.x
      press.dy = ev.clientY - press.y
      if (!press.moving && Math.hypot(press.dx, press.dy) < DRAG_THRESHOLD)
        return
      if (!press.moving) {
        press.moving = true
        // Cover the page (and its iframes) so the drag keeps every move.
        host.dataset.dragging = ""
        element()?.setAttribute("data-dragging", "")
      }
      ev.preventDefault()
      element()?.style.setProperty(
        "transform",
        `translate(${press.dx}px, ${press.dy}px)`
      )
    }
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== press.id) return
      endDrag?.()
      if (press.moving) drop(element(), true)
    }
    // A cancelled press (or leaving the window mid-drag) goes back where it was.
    const onCancel = (ev: Event) => {
      if (ev instanceof PointerEvent && ev.pointerId !== press.id) return
      endDrag?.()
      if (press.moving) drop(element(), false)
    }
    window.addEventListener("pointermove", onMove, true)
    window.addEventListener("pointerup", onUp, true)
    window.addEventListener("pointercancel", onCancel, true)
    window.addEventListener("blur", onCancel)
    endDrag = () => {
      window.removeEventListener("pointermove", onMove, true)
      window.removeEventListener("pointerup", onUp, true)
      window.removeEventListener("pointercancel", onCancel, true)
      window.removeEventListener("blur", onCancel)
      delete host.dataset.dragging
      drag = endDrag = null
    }
  }

  return {
    get position() {
      return position
    },

    stop() {
      endDrag?.()
    },

    render() {
      const { picker, panel, pins } = ctx
      const open = ctx.page.comments.filter((c) => c.status === "open").length
      const moving = drag?.moving ? drag : null
      return h(
        "div",
        {
          class: "toolbar",
          role: "toolbar",
          "aria-label": ctx.t("toolbar"),
          "data-dragging": !!moving,
          "data-pins-hidden": pins.hidden,
          style:
            moving && `transform: translate(${moving.dx}px, ${moving.dy}px)`,
          onpointerdown: (e: Event) => startDrag(e as PointerEvent),
        },
        h(
          "button",
          {
            class: "tb-btn",
            type: "button",
            "aria-pressed": String(picker.active),
            "data-focus-key": "tb-comment",
            "aria-label": ctx.t(picker.active ? "cancelAdding" : "addComment"),
            title: ctx.withKey("addComment", "addCommentKey"),
            onclick: () => picker.set(!picker.active),
          },
          icon(ICONS.comment),
          h(
            "span",
            { class: "tb-label" },
            picker.active
              ? ctx.t("pickElement")
              : (config.label ?? ctx.t("comment"))
          )
        ),
        h(
          "button",
          {
            class: "tb-btn",
            type: "button",
            "aria-pressed": String(panel.open),
            "data-focus-key": "tb-panel",
            "aria-label": ctx.t("openCount", { count: open }),
            title: ctx.t("allComments"),
            onclick: () => panel.toggle(),
          },
          icon(ICONS.list),
          h("span", { class: "tb-count" }, String(open))
        ),
        h(
          "button",
          {
            class: "tb-btn tb-icon",
            type: "button",
            "aria-pressed": String(pins.hidden),
            "data-focus-key": "tb-hide",
            "aria-label": ctx.t("hideComments"),
            title: ctx.withKey("hideComments", "hideCommentsKey"),
            onclick: () => pins.setHidden(!pins.hidden),
          },
          icon(pins.hidden ? ICONS.eyeOff : ICONS.eye)
        )
      )
    },
  }
}

/** The toolbar spot nearest a point: thirds across the screen, halves down. */
function nearestPosition(x: number, y: number): Position {
  const width = window.innerWidth
  const across =
    x < width / 3 ? "left" : x > (width * 2) / 3 ? "right" : "center"
  return `${y < window.innerHeight / 2 ? "top" : "bottom"}-${across}`
}
