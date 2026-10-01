export { captureAnchor } from "./capture"
export { reactComponentName } from "./component"
export { documentRect, isRendered } from "./geometry"
export type { AnchorOptions } from "./options"
export {
  createResolveCache,
  resolveAnchor,
  type Confidence,
  type ResolveCache,
  type ResolveResult,
} from "./resolve"
export {
  frameDocument,
  frameElementOf,
  isShadowRoot,
  scopeRootOf,
  viewportRect,
  type ScopeRoot,
  type ViewportRect,
} from "./scope"
export { buildCssSelector, buildPath } from "./selector"
export { isStableClass, isStableId } from "./stable"
export { pickTarget } from "./target"
export { elementText, textSimilarity } from "./text"
