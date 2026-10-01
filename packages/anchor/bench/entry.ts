import { captureAnchor, createResolveCache, resolveAnchor } from "../src"

;(window as unknown as Record<string, unknown>).NuniAnchor = {
  captureAnchor,
  createResolveCache,
  resolveAnchor,
}
