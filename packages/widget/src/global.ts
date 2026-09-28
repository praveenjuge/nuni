import { init, VERSION } from "./index"

declare global {
  interface Window {
    Nuni?: { init: typeof init; version: string }
  }
}

window.Nuni = { init, version: VERSION }

// <script src=".../nuni.global.js" data-project="nuni_..."></script>
const script =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>("script[data-project][src*='nuni']")
const project = script?.dataset.project
if (project) {
  init({
    project,
    convexUrl: script?.dataset.convexUrl,
    convexSiteUrl: script?.dataset.convexSiteUrl,
    appUrl: script?.dataset.appUrl,
  })
}
