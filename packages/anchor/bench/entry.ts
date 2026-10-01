import {
  captureAnchor,
  captureSelection,
  createResolveCache,
  resolveAnchor,
} from "../src"
import { textMap, textOffset } from "../src/quote"

;(window as unknown as Record<string, unknown>).NuniAnchor = {
  captureAnchor,
  captureSelection,
  createResolveCache,
  resolveAnchor,
  textMap,
  textOffset,
}
