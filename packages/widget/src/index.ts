import { isProjectId } from "@nuni/shared"

import { resolveConfig, VERSION, type NuniOptions } from "./config"
import { NuniWidget } from "./widget"

export type { NuniOptions } from "./config"
export { VERSION }

export interface NuniInstance {
  destroy(): void
}

let active: {
  project: string
  widget: NuniWidget | null
  timer: number
} | null = null

/**
 * Mount Nuni on the page. Call once on the client. Calling it again with
 * the same project is a no-op; with a different project it replaces it.
 */
export function init(options: NuniOptions): NuniInstance {
  const noop = { destroy() {} }
  if (typeof window === "undefined" || typeof document === "undefined")
    return noop
  if (!isProjectId(options.project)) {
    console.warn(
      `[nuni] "${options.project}" is not a valid project ID. Run \`npx @nuni/cli init\` to get one.`
    )
    return noop
  }
  if (active?.project === options.project) return { destroy: destroyActive }
  destroyActive()

  const config = resolveConfig(options)
  const state = {
    project: options.project,
    widget: null as NuniWidget | null,
    timer: 0,
  }
  active = state

  const mount = () => {
    if (active !== state) return
    if (!document.body) {
      state.timer = window.setTimeout(mount, 50)
      return
    }
    state.widget = new NuniWidget(config)
    state.widget.start()
  }
  // Stay out of the way of the host page's first render.
  const idle = (
    window as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    }
  ).requestIdleCallback
  if (idle) idle(mount, { timeout: 1500 })
  else state.timer = window.setTimeout(mount, 1)

  return { destroy: destroyActive }
}

function destroyActive() {
  if (!active) return
  clearTimeout(active.timer)
  active.widget?.destroy()
  active = null
}
