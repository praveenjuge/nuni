"use client"

import { api } from "@nuni/backend/api"
import { useConvexAuth, useMutation } from "convex/react"
import { useEffect, useState } from "react"

/** Make sure the signed-in WorkOS user has a row in Convex. */
export function useStoreUser() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const store = useMutation(api.users.store)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    store({})
      .then(() => !cancelled && setReady(true))
      .catch(() => !cancelled && setReady(false))
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, store])
  return {
    ready: isAuthenticated && ready,
    isLoading: isLoading || (isAuthenticated && !ready),
    isAuthenticated,
  }
}
