import {
  captureAnchor,
  captureSelection,
  createResolveCache,
  resolveAnchor,
} from "../src"
import { textMap, textOffset } from "../src/quote"

const engine = {
  captureAnchor,
  captureSelection,
  createResolveCache,
  resolveAnchor,
  textMap,
  textOffset,
}

/** The engine API the bench page gets as `window.NuniAnchor`. */
export type Engine = typeof engine
;(window as unknown as { NuniAnchor: Engine }).NuniAnchor = engine
