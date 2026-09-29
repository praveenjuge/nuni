import { isProjectId } from "@nuni/shared"

import { resolveConfig, VERSION, type NuniOptions } from "./config"
import { NuniWidget } from "./widget"

export type { NuniOptions } from "./config"
export { VERSION }

export interface NuniInstance {
  destroy(): void
}

interface Mounted {
  project: string
  widget: NuniWidget | null
  timer: number
  handles: number
}

let active: Mounted | null = null

/**
 * Mount Nuni on the page. Call once on the client. Calling it again with the
 * same project shares the mounted widget; it is removed when every handle is
 * destroyed. A different project replaces it. Each handle only ever tears
 * down the widget it was created for.
 */
export function init(options: NuniOptions): NuniInstance {
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
    timer: 0,
    handles: 0,
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
  if (active === state) active = null
}
