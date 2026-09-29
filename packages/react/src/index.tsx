"use client"

import { init, type NuniOptions } from "@nuniapp/widget"
import { useEffect } from "react"

export type NuniProps = NuniOptions

/**
 * Mounts Nuni once for the whole app. Render it in your root layout.
 *
 * ```tsx
 * <Nuni project="nuni_..." />
 * ```
 */
export function Nuni({
  project,
  convexUrl,
  convexSiteUrl,
  appUrl,
  getPageKey,
  capture,
}: NuniProps) {
  // Primitive deps, so an inline `capture` object does not remount the widget.
  const { console: logs, network, dom, screenshot } = capture ?? {}
  useEffect(() => {
    const instance = init({
      project,
      convexUrl,
      convexSiteUrl,
      appUrl,
      getPageKey,
      capture: { console: logs, network, dom, screenshot },
    })
    return () => instance.destroy()
    // getPageKey is read once; changing it at runtime is not supported.
  }, [
    project,
    convexUrl,
    convexSiteUrl,
    appUrl,
    logs,
    network,
    dom,
    screenshot,
  ])
  return null
}

export default Nuni
