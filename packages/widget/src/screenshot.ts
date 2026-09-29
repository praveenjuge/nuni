import { LIMITS } from "@nuni/shared"
import { domToCanvas } from "modern-screenshot"

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

/**
 * The element with some surroundings: the closest ancestor that is big
 * enough to show where the element sits, without growing to the whole page.
 */
export function contextElement(el: Element): Element {
  const doc = el.ownerDocument
  const vw = doc.documentElement.clientWidth || window.innerWidth
  const vh = doc.documentElement.clientHeight || window.innerHeight
  let node = el
  while (node.parentElement && node.parentElement !== doc.body) {
    const r = node.getBoundingClientRect()
    if (r.width >= Math.min(480, vw) && r.height >= Math.min(240, vh)) break
    const p = node.parentElement.getBoundingClientRect()
    if (p.width * p.height > vw * vh * 1.5) break
    node = node.parentElement
  }
  return node
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality)
  )
}

export const captureScreenshot: CaptureScreenshot = async (el, options) => {
  const frame = contextElement(el)
  const box = frame.getBoundingClientRect()
  if (box.width < 1 || box.height < 1) return null
  const scale = Math.min(
    window.devicePixelRatio || 1,
    MAX_WIDTH / box.width,
    MAX_HEIGHT / box.height
  )
  const body = el.ownerDocument.body
  const background =
    getComputedStyle(body).backgroundColor || "rgb(255, 255, 255)"
  const canvas = await domToCanvas(frame, {
    scale,
    backgroundColor:
      background === "rgba(0, 0, 0, 0)" ? "rgb(255, 255, 255)" : background,
    filter: (node) => node !== options.exclude,
    timeout: 8000,
  })

  // Outline the commented element, so it is obvious in a busy screenshot.
  const target = el.getBoundingClientRect()
  const ctx = canvas.getContext("2d")
  if (ctx && frame !== el) {
    const pad = 4
    ctx.strokeStyle = options.accent
    ctx.lineWidth = Math.max(2, 3 * scale)
    ctx.strokeRect(
      (target.left - box.left - pad) * scale,
      (target.top - box.top - pad) * scale,
      (target.width + pad * 2) * scale,
      (target.height + pad * 2) * scale
    )
  }

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
