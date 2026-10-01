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
  pageKey,
  capture,
  position,
  accentColor,
  theme,
  label,
  hotkey,
  zIndex,
  locale,
  messages,
}: NuniProps) {
  // Primitive deps, so an inline `capture` object does not remount the widget.
  const { console: logs, network, dom, screenshot } = capture ?? {}
  // Same for an inline `messages` object: compare its contents.
  const words = messages ? JSON.stringify(messages) : ""
  useEffect(() => {
    const instance = init({
      project,
      convexUrl,
      convexSiteUrl,
      appUrl,
      getPageKey,
      pageKey,
      capture: { console: logs, network, dom, screenshot },
      position,
      accentColor,
      theme,
      label,
      hotkey,
      zIndex,
      locale,
      messages: words ? (JSON.parse(words) as NuniOptions["messages"]) : {},
    })
    return () => instance.destroy()
    // getPageKey is read once; changing it at runtime is not supported.
  }, [
    project,
    convexUrl,
    convexSiteUrl,
    appUrl,
    pageKey,
    logs,
    network,
    dom,
    screenshot,
    position,
    accentColor,
    theme,
    label,
    hotkey,
    zIndex,
    locale,
    words,
  ])
  return null
}

export default Nuni
