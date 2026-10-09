import { VERSION, type NuniOptions } from "./config"
import { mount } from "./mount"
import type { ScreenshotTools } from "./screenshot-tools"

declare global {
  interface Window {
    Nuni?: { init: typeof init; version: string }
  }
}

// <script src=".../nuni.global.js" data-project="nuni_..."></script>
const script =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>("script[data-project][src*='nuni']")

let screenshot: Promise<ScreenshotTools | null> | null = null

/** The screenshot code is a second file next to this one, loaded on demand. */
function loadScreenshot(): Promise<ScreenshotTools | null> {
  screenshot ??= new Promise((resolve) => {
    if (window.__nuniScreenshot) return resolve(window.__nuniScreenshot)
    const el = document.createElement("script")
    el.src = new URL("nuni-screenshot.global.js", script!.src).href
    el.async = true
    el.onload = () => resolve(window.__nuniScreenshot ?? null)
    el.onerror = () => {
      screenshot = null
      resolve(null)
    }
    document.head.appendChild(el)
  })
  return screenshot
}

function init(options: NuniOptions) {
  return mount(options, { loadScreenshot: script?.src ? loadScreenshot : null })
}

window.Nuni = { init, version: VERSION }

/** `data-capture-console="false"` and friends turn a capture off. */
function flag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  return !/^(false|0|off|no)$/i.test(value.trim())
}

const data = script?.dataset
if (data?.project) {
  init({
    project: data.project,
    convexUrl: data.convexUrl,
    convexSiteUrl: data.convexSiteUrl,
    appUrl: data.appUrl,
    pageKey: data.pageKey as NuniOptions["pageKey"],
    position: data.position as NuniOptions["position"],
    accentColor: data.accentColor,
    theme: data.theme as NuniOptions["theme"],
    label: data.label,
    hotkey:
      data.hotkey === undefined
        ? undefined
        : flag(data.hotkey) === false
          ? false
          : data.hotkey,
    // `!== undefined`, so data-z-index="0" works too.
    zIndex: data.zIndex !== undefined ? Number(data.zIndex) : undefined,
    locale: data.locale,
    images: flag(data.images),
    capture: {
      console: flag(data.captureConsole),
      network: flag(data.captureNetwork),
      dom: flag(data.captureDom),
      screenshot: flag(data.captureScreenshot),
    },
  })
}
