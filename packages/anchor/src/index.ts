export type { Box } from "./capture"
export {
  areaContainer,
  captureAnchor,
  captureArea,
  captureSelection,
  resolveAnchor,
} from "./compat"
export { isRendered } from "./geometry"
export {
  createResolveCache,
  stillMatches,
  type Confidence,
  type ResolveCache,
  type ResolveOptions,
  type ResolveResult,
} from "./resolve"
export {
  frameDocument,
  frameDocuments,
  frameElementOf,
  isShadowRoot,
  scopeChain,
  scopeRootOf,
  viewportRect,
  type ScopeRoot,
  type ScopeStep,
} from "./scope"
export { pickTarget } from "./target"
export { elementText, textSimilarity } from "./text"
