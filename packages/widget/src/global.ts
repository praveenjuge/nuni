import { VERSION, type NuniOptions } from "./config"
import { mount } from "./mount"
import type { CaptureScreenshot } from "./screenshot"

declare global {
  interface Window {
    Nuni?: { init: typeof init; version: string }
  }
}

// <script src=".../nuni.global.js" data-project="nuni_..."></script>
const script =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>("script[data-project][src*='nuni']")

let screenshot: Promise<CaptureScreenshot | null> | null = null

/** The screenshot code is a second file next to this one, loaded on demand. */
function loadScreenshot(): Promise<CaptureScreenshot | null> {
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
    capture: {
      console: flag(data.captureConsole),
      network: flag(data.captureNetwork),
      dom: flag(data.captureDom),
      screenshot: flag(data.captureScreenshot),
    },
  })
}
