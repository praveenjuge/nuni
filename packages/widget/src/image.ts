import { LIMITS } from "@nuni/shared"

/** The image types the backend accepts. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"]

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality)
  )
}

/**
 * WebP, or JPEG where the browser can't encode WebP, at the best quality
 * that fits `maxBytes`. Null when even the smallest doesn't fit.
 */
export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  maxBytes: number
): Promise<Blob | null> {
  for (const [type, quality] of [
    ["image/webp", 0.82],
    ["image/jpeg", 0.8],
    ["image/jpeg", 0.55],
  ] as const) {
    const blob = await toBlob(canvas, type, quality)
    // Browsers without WebP encoding fall back to PNG; try JPEG instead.
    if (blob && blob.type === type && blob.size <= maxBytes) return blob
  }
  return null
}

/**
 * An image someone picked or pasted, scaled down to the size limit and
 * re-encoded, which also drops its metadata (location, camera). Null when
 * it isn't a readable image.
 */
export async function imageFromFile(file: Blob): Promise<Blob | null> {
  if (!IMAGE_TYPES.includes(file.type)) return null
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }
  const scale = Math.min(
    1,
    LIMITS.imageMaxSide / Math.max(bitmap.width, bitmap.height)
  )
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  // Transparent PNGs become white, like the page behind most screenshots.
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return encodeCanvas(canvas, LIMITS.imageMaxBytes)
}
