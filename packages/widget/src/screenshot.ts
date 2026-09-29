import { LIMITS, MASK_ATTRIBUTE } from "@nuni/shared"
import { domToCanvas } from "modern-screenshot"

import { CAPTURE_MARK } from "./mark"

/**
 * Screenshots are loaded lazily (a separate chunk for npm users, a separate
 * script for the CDN build), so the widget itself stays small.
 */

export interface ScreenshotOptions {
  /** Nuni's own host element, left out of the image. */
  exclude: Element
  /** Outline color drawn around the commented element. */
  accent: string
}

export type CaptureScreenshot = (
  el: Element,
  options: ScreenshotOptions
) => Promise<Blob | null>

declare global {
  interface Window {
    /** Set by nuni-screenshot.global.js (the CDN build). */
    __nuniScreenshot?: CaptureScreenshot
  }
}

const MAX_WIDTH = 1280
const MAX_HEIGHT = 1600
/** Largest canvas side rendered before cropping. */
const MAX_RENDER = 4096
/** How much of the surroundings is kept around the element, in CSS px. */
const MARGIN = 48
const MASK_COLOR = "#a1a1aa"
const MASKED_INPUT_TYPES = new Set([
  "",
  "text",
  "email",
  "tel",
  "url",
  "search",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
])

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const around = (b: Box): Box => ({
  left: b.left - MARGIN,
  top: b.top - MARGIN,
  right: b.right + MARGIN,
  bottom: b.bottom + MARGIN,
})

/**
 * The closest ancestor that contains the element plus a small margin: the
 * node to render from. Only that margin ends up in the image, never the rest
 * of the page (it may hold the visitor's own data).
 */
export function frameFor(el: Element): Element {
  const doc = el.ownerDocument
  const want = around(el.getBoundingClientRect())
  let frame = el
  while (frame.parentElement && frame.parentElement !== doc.body) {
    const r = frame.getBoundingClientRect()
    if (
      r.left <= want.left &&
      r.top <= want.top &&
      r.right >= want.right &&
      r.bottom >= want.bottom
    )
      break
    frame = frame.parentElement
  }
  return frame
}

/**
 * Measure the frame the way the renderer lays it out. The clone is rendered
 * on its own, so a child margin that collapses through the frame on the page
 * stays inside it there; `display: flow-root` gives that same layout. The
 * frame's style attribute is restored exactly afterwards.
 */
export function isolatedLayout(frame: Element, el: Element) {
  const { display } = getComputedStyle(frame)
  const isolate = display === "block" || display === "list-item"
  const before = frame.getAttribute("style")
  // The attribute, not element.style: touching the CSSOM declaration makes
  // the browser write an empty style attribute back later.
  if (isolate)
    frame.setAttribute(
      "style",
      `${before ? `${before};` : ""}display: flow-root !important`
    )
  try {
    const box = frame.getBoundingClientRect()
    const target = el.getBoundingClientRect()
    const want = around(target)
    return {
      box,
      target,
      masks: maskedBoxes(frame),
      crop: {
        left: Math.max(box.left, want.left),
        top: Math.max(box.top, want.top),
        right: Math.min(box.right, want.right),
        bottom: Math.min(box.bottom, want.bottom),
      },
    }
  } finally {
    if (isolate) {
      if (before === null) frame.removeAttribute("style")
      else frame.setAttribute("style", before)
    }
  }
}

function contentBox(el: Element): Box {
  const r = el.getBoundingClientRect()
  const s = getComputedStyle(el)
  const px = (value: string) => parseFloat(value) || 0
  return {
    left: r.left + px(s.borderLeftWidth) + px(s.paddingLeft),
    top: r.top + px(s.borderTopWidth) + px(s.paddingTop),
    right: r.right - px(s.borderRightWidth) - px(s.paddingRight),
    bottom: r.bottom - px(s.borderBottomWidth) - px(s.paddingBottom),
  }
}

/**
 * Areas painted over: what people typed into form fields (the field's
 * border stays visible) and anything marked with data-nuni-mask.
 */
export function maskedBoxes(frame: Element): Box[] {
  const out: Box[] = []
  const fields = frame.querySelectorAll(
    `input, textarea, select, [${MASK_ATTRIBUTE}]`
  )
  // Inside a masked area, everything is masked.
  const masked = frame.closest(`[${MASK_ATTRIBUTE}]`)
  if (masked) return [masked.getBoundingClientRect()]
  for (const el of [frame, ...Array.from(fields)]) {
    if (el.hasAttribute(MASK_ATTRIBUTE)) {
      out.push(el.getBoundingClientRect())
      continue
    }
    const tag = el.tagName
    if (
      (tag === "INPUT" &&
        MASKED_INPUT_TYPES.has(
          (el.getAttribute("type") ?? "").toLowerCase()
        )) ||
      tag === "TEXTAREA" ||
      tag === "SELECT"
    )
      out.push(contentBox(el))
  }
  return out
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality)
  )
}

export const captureScreenshot: CaptureScreenshot = async (el, options) => {
  const frame = frameFor(el)
  const { box, target, masks, crop } = isolatedLayout(frame, el)
  const cropW = crop.right - crop.left
  const cropH = crop.bottom - crop.top
  if (cropW < 1 || cropH < 1) return null
  const scale = Math.min(
    window.devicePixelRatio || 1,
    MAX_WIDTH / cropW,
    MAX_HEIGHT / cropH,
    MAX_RENDER / box.width,
    MAX_RENDER / box.height
  )
  const background =
    getComputedStyle(el.ownerDocument.body).backgroundColor ||
    "rgb(255, 255, 255)"
  const rendered = await domToCanvas(frame, {
    width: box.width,
    height: box.height,
    scale,
    backgroundColor:
      background === "rgba(0, 0, 0, 0)" ? "rgb(255, 255, 255)" : background,
    filter: (node) => node !== options.exclude,
    timeout: 8000,
    // Tag the font and image requests, so they are not reported as the page's.
    fetch: {
      requestInit: {
        cache: "force-cache",
        [CAPTURE_MARK]: true,
      } as RequestInit,
    },
  })

  const canvas = el.ownerDocument.createElement("canvas")
  canvas.width = Math.max(1, Math.round(cropW * scale))
  canvas.height = Math.max(1, Math.round(cropH * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(
    rendered,
    (crop.left - box.left) * scale,
    (crop.top - box.top) * scale,
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height
  )

  const toCanvas = (b: Box) => ({
    x: (b.left - crop.left) * scale,
    y: (b.top - crop.top) * scale,
    w: (b.right - b.left) * scale,
    h: (b.bottom - b.top) * scale,
  })
  ctx.fillStyle = MASK_COLOR
  for (const mask of masks) {
    const { x, y, w, h } = toCanvas(mask)
    if (w > 0 && h > 0) ctx.fillRect(x, y, w, h)
  }

  // Outline the commented element. Kept inside the image, so it still shows
  // when the element fills the whole screenshot.
  const line = Math.max(2, 3 * scale)
  const half = line / 2
  const pad = 4 * scale
  const t = toCanvas(target)
  const x0 = Math.max(half, t.x - pad)
  const y0 = Math.max(half, t.y - pad)
  const x1 = Math.min(canvas.width - half, t.x + t.w + pad)
  const y1 = Math.min(canvas.height - half, t.y + t.h + pad)
  ctx.strokeStyle = options.accent
  ctx.lineWidth = line
  if (x1 > x0 && y1 > y0) ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)

  for (const [type, quality] of [
    ["image/webp", 0.82],
    ["image/jpeg", 0.8],
    ["image/jpeg", 0.55],
  ] as const) {
    const blob = await toBlob(canvas, type, quality)
    // Browsers without WebP encoding fall back to PNG; try JPEG instead.
    if (blob && blob.type === type && blob.size <= LIMITS.screenshotMaxBytes)
      return blob
  }
  return null
}
