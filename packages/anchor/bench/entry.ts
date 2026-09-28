import { captureAnchor, resolveAnchor } from "../src"

;(window as unknown as Record<string, unknown>).NuniAnchor = {
  captureAnchor,
  resolveAnchor,
}
