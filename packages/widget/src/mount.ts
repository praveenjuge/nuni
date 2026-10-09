import { isProjectId } from "@nuni/shared"

import { resolveConfig, type NuniOptions, type ResolvedConfig } from "./config"
import { startCollectors, type Collectors } from "./context"
import type { ScreenshotTools } from "./screenshot-tools"
import { NuniWidget } from "./widget"

export interface NuniInstance {
  destroy(): void
}

/** What differs between the npm (ESM) build and the CDN script. */
export interface Runtime {
  loadScreenshot: (() => Promise<ScreenshotTools | null>) | null
}

interface Mounted {
  project: string
  widget: NuniWidget | null
  collectors: Collectors
  timer: number
  handles: number
}

/** Nuni's own requests are not the page's problem. */
function isNuniUrl(config: ResolvedConfig) {
  const origins = [config.convexUrl, config.convexSiteUrl].flatMap((url) => {
    try {
      return [new URL(url).origin]
    } catch {
      return []
    }
  })
  return (url: string) => {
    try {
      return origins.includes(new URL(url, location.href).origin)
    } catch {
      return false
    }
  }
}

let active: Mounted | null = null

/** The shared implementation of `init` for both builds (see index.ts). */
export function mount(options: NuniOptions, runtime: Runtime): NuniInstance {
  const noop = { destroy() {} }
  if (typeof window === "undefined" || typeof document === "undefined")
    return noop
  if (!isProjectId(options.project)) {
    console.warn(
      `[nuni] "${options.project}" is not a valid project ID. Run \`npx @nuniapp/cli@latest init\` to get one.`
    )
    return noop
  }
  if (active?.project === options.project) return handleFor(active)
  if (active) unmount(active)

  const config = resolveConfig(options)
  const state: Mounted = {
    project: options.project,
    widget: null,
    // Started right away, so errors during the first render are kept too.
    collectors: startCollectors(config.capture, isNuniUrl(config)),
    timer: 0,
    handles: 0,
  }
  active = state

  const start = () => {
    if (active !== state) return
    if (!document.body) {
      state.timer = window.setTimeout(start, 50)
      return
    }
    state.widget = new NuniWidget(config, {
      collectors: state.collectors,
      loadScreenshot: config.capture.screenshot ? runtime.loadScreenshot : null,
    })
    state.widget.start()
  }
  // Stay out of the way of the host page's first render.
  const idle = (
    window as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    }
  ).requestIdleCallback
  if (idle) idle(start, { timeout: 1500 })
  else state.timer = window.setTimeout(start, 1)

  return handleFor(state)
}

function handleFor(state: Mounted): NuniInstance {
  state.handles++
  let released = false
  return {
    destroy() {
      if (released) return
      released = true
      state.handles--
      if (state.handles <= 0 && active === state) unmount(state)
    },
  }
}

function unmount(state: Mounted) {
  clearTimeout(state.timer)
  state.widget?.destroy()
  state.widget = null
  state.collectors.stop()
  if (active === state) active = null
}
