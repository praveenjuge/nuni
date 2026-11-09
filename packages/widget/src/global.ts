import { optionsFromAttributes, VERSION, type NuniOptions } from "./config"
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

const options = script ? optionsFromAttributes(script.dataset) : null
if (options?.project) init(options as NuniOptions)
