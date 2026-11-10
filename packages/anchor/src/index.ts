export {
  areaContainer,
  captureAnchor,
  captureArea,
  captureSelection,
  type Box,
} from "./capture"
export { isRendered } from "./geometry"
export {
  createResolveCache,
  resolveAnchor,
  stillMatches,
  type Confidence,
  type ResolveCache,
  type ResolveOptions,
  type ResolveResult,
} from "./resolve"
export {
  frameDocuments,
  scopeChain,
  viewportRect,
  type ScopeRoot,
  type ScopeStep,
} from "./scope"
export { pickTarget } from "./target"
export { elementText } from "./text"
