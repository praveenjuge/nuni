import { LIMITS } from "@nuni/shared"

import { h } from "./dom"
import { encodeCanvas } from "./image"

/**
 * A small editor to draw boxes, arrows and freehand lines on a screenshot
 * before it is attached. Loaded with the screenshot code, on demand.
 */

export interface MarkUpLabels {
  title: string
  box: string
  arrow: string
  pen: string
  undo: string
  cancel: string
  done: string
  /** Shown when the drawing can't be saved as an image. */
  failed: string
}

export interface MarkUpOptions {
  /** Where the editor opens: inside the widget's shadow root. */
  container: HTMLElement
  labels: MarkUpLabels
  color: string
}

/** Resolves with the marked-up image, or null when cancelled. */
export type MarkUp = (
  image: Blob,
  options: MarkUpOptions
) => Promise<Blob | null>

type Tool = "box" | "arrow" | "pen"
type Point = { x: number; y: number }
type Shape = { tool: Tool; points: Point[] }

const STYLES = `
.mk {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgb(0 0 0 / 0.55);
  pointer-events: auto;
  z-index: 10;
}
.mk-box {
  display: grid;
  gap: 10px;
  max-width: 100%;
  padding: 10px;
  border-radius: 14px;
  background: var(--n-bg);
  color: var(--n-fg);
  box-shadow: var(--n-shadow);
}
.mk-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.mk-bar .spacer { flex: 1; }
.mk-error { margin: 0; color: var(--n-danger); font-size: 13px; }
.mk-error:empty { display: none; }
.mk-bar [aria-pressed="true"] { background: var(--n-accent-soft); border-color: var(--n-accent); }
.mk-canvas {
  display: block;
  max-width: min(960px, calc(100vw - 52px));
  max-height: calc(100vh - 120px);
  border-radius: 8px;
  cursor: crosshair;
  touch-action: none;
}
`

function lineWidth(canvas: HTMLCanvasElement) {
  return Math.max(3, Math.round(Math.max(canvas.width, canvas.height) / 250))
}

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, width: number) {
  const [a, b] = shape.points
  if (!a) return
  ctx.beginPath()
  if (shape.tool === "pen") {
    ctx.moveTo(a.x, a.y)
    for (const p of shape.points.slice(1)) ctx.lineTo(p.x, p.y)
  } else if (b && shape.tool === "box") {
    ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y)
  } else if (b) {
    // A line with a head at the end it was drawn to.
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    const head = width * 4
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    for (const side of [-1, 1]) {
      ctx.moveTo(b.x, b.y)
      ctx.lineTo(
        b.x - head * Math.cos(angle + (side * Math.PI) / 7),
        b.y - head * Math.sin(angle + (side * Math.PI) / 7)
      )
    }
  }
  ctx.stroke()
}

/** Big enough to be meant, not a stray click. */
function isDrawn(shape: Shape): boolean {
  const [a, b] = shape.points
  if (!a || !b) return false
  if (shape.tool === "pen") return shape.points.length > 2
  return Math.hypot(b.x - a.x, b.y - a.y) > 6
}

export const markUp: MarkUp = async (image, { container, labels, color }) => {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(image)
  } catch {
    return null
  }
  const root = container.getRootNode() as ShadowRoot | Document
  if (!root.querySelector("style[data-nuni-markup]")) {
    const style = h("style", { "data-nuni-markup": "" }, STYLES)
    ;(root instanceof Document ? root.head : root).append(style)
  }

  const canvas = h("canvas", {
    class: "mk-canvas",
    width: bitmap.width,
    height: bitmap.height,
    role: "img",
    "aria-label": labels.title,
  })
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    bitmap.close()
    return null
  }
  const width = lineWidth(canvas)
  const shapes: Shape[] = []
  let current: Shape | null = null
  let tool: Tool = "box"

  const draw = () => {
    ctx.drawImage(bitmap, 0, 0)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    for (const shape of current ? [...shapes, current] : shapes) {
      drawShape(ctx, shape, width)
    }
    undo.disabled = shapes.length === 0
  }

  const point = (e: PointerEvent): Point => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    }
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary) return
    e.preventDefault()
    canvas.setPointerCapture(e.pointerId)
    const p = point(e)
    current = { tool, points: tool === "pen" ? [p] : [p, p] }
    draw()
  })
  canvas.addEventListener("pointermove", (e) => {
    if (!current) return
    const p = point(e)
    if (current.tool === "pen") current.points.push(p)
    else current.points[1] = p
    draw()
  })
  const finish = () => {
    if (current && isDrawn(current)) shapes.push(current)
    current = null
    draw()
  }
  canvas.addEventListener("pointerup", finish)
  canvas.addEventListener("pointercancel", finish)

  const toolButtons = (["box", "arrow", "pen"] as const).map((name) =>
    h(
      "button",
      {
        class: "btn",
        type: "button",
        "aria-pressed": String(name === tool),
        onclick: () => {
          tool = name
          for (const b of toolButtons) {
            b.setAttribute("aria-pressed", String(b.dataset.tool === tool))
          }
        },
        "data-tool": name,
      },
      labels[name]
    )
  )
  const undo = h(
    "button",
    {
      class: "btn btn-ghost",
      type: "button",
      onclick: () => {
        shapes.pop()
        draw()
      },
    },
    labels.undo
  )

  const previous = (root as ShadowRoot | Document)
    .activeElement as HTMLElement | null
  return new Promise<Blob | null>((resolve) => {
    // Attach pressed twice, or Escape while saving: close only once.
    let closing = false
    const close = async (save: boolean) => {
      if (closing) return
      closing = true
      const result = save
        ? await encodeCanvas(canvas, LIMITS.imageMaxBytes)
        : null
      if (save && !result) {
        // Keep the drawing; say why nothing was attached.
        closing = false
        error.textContent = labels.failed
        return
      }
      overlay.remove()
      bitmap.close()
      previous?.focus()
      resolve(result)
    }
    const error = h("p", { class: "mk-error", role: "alert" })
    const done = h(
      "button",
      {
        class: "btn btn-primary",
        type: "button",
        onclick: () => void close(true),
      },
      labels.done
    )
    const overlay = h(
      "div",
      {
        class: "mk",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": labels.title,
        onkeydown: (e: Event) => {
          const key = e as KeyboardEvent
          if (key.key === "Escape") void close(false)
          else if (key.key === "z" && (key.metaKey || key.ctrlKey)) {
            shapes.pop()
            draw()
          } else return
          key.preventDefault()
        },
      },
      h(
        "div",
        { class: "mk-box" },
        h(
          "div",
          { class: "mk-bar", role: "toolbar", "aria-label": labels.title },
          ...toolButtons,
          undo,
          h("span", { class: "spacer" }),
          h(
            "button",
            {
              class: "btn btn-ghost",
              type: "button",
              onclick: () => void close(false),
            },
            labels.cancel
          ),
          done
        ),
        error,
        canvas
      )
    )
    container.append(overlay)
    draw()
    done.focus()
  })
}
