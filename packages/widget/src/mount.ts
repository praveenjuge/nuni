import { cliCommand, isProjectId } from "@nuni/shared"

import { resolveConfig, type NuniOptions } from "./config"
import { startCollectors, type Collectors } from "./context"
import { whenIdle } from "./dom"
import { ownTraffic } from "./mark"
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
  handles: number
}

let active: Mounted | null = null

/** The shared implementation of `init` for both builds (see index.ts). */
export function mount(options: NuniOptions, runtime: Runtime): NuniInstance {
  const noop = { destroy() {} }
  if (typeof window === "undefined" || typeof document === "undefined")
    return noop
  if (!isProjectId(options.project)) {
    console.warn(
      `[nuni] "${options.project}" is not a valid project ID. Run \`${cliCommand("init")}\` to get one.`
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
    collectors: startCollectors(
      config.capture,
      ownTraffic([config.convexUrl, config.convexSiteUrl])
    ),
    handles: 0,
  }
  active = state

  const start = () => {
    if (active !== state || state.widget) return
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", start, { once: true })
      return
    }
    state.widget = new NuniWidget(config, {
      collectors: state.collectors,
      loadScreenshot: config.capture.screenshot ? runtime.loadScreenshot : null,
    })
    state.widget.start()
  }
  // Stay out of the way of the host page's first render.
  whenIdle(start, 1500)

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
  state.widget?.destroy()
  state.widget = null
  state.collectors.stop()
  if (active === state) active = null
}
