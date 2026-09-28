"use client"

import { init, type NuniOptions } from "@nuni/widget"
import { useEffect } from "react"

export type NuniProps = NuniOptions

/**
 * Mounts Nuni once for the whole app. Render it in your root layout.
 *
 * ```tsx
 * <Nuni project="nuni_..." />
 * ```
 */
export function Nuni({ project, convexUrl, convexSiteUrl, appUrl, getPageKey }: NuniProps) {
  useEffect(() => {
    const instance = init({ project, convexUrl, convexSiteUrl, appUrl, getPageKey })
    return () => instance.destroy()
    // getPageKey is read once; changing it at runtime is not supported.
  }, [project, convexUrl, convexSiteUrl, appUrl])
  return null
}

export default Nuni
