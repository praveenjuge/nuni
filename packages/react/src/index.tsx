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
export function Nuni({ getPageKey, ...options }: NuniProps) {
  // Inline objects such as `capture` or `messages` are new on every render,
  // so the widget remounts only when an option's contents change.
  const key = JSON.stringify(options)
  useEffect(() => {
    const instance = init({
      ...(JSON.parse(key) as Omit<NuniOptions, "getPageKey">),
      getPageKey,
    })
    return () => instance.destroy()
    // getPageKey is read once; changing it at runtime is not supported.
  }, [key])
  return null
}

export default Nuni
