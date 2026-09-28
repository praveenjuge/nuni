"use client"

import {
  AuthKitProvider,
  useAccessToken,
  useAuth,
} from "@workos-inc/authkit-nextjs/components"
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react"
import { useCallback, useState, type ReactNode } from "react"

function useAuthFromAuthKit() {
  const { user, loading } = useAuth()
  const { getAccessToken, refresh } = useAccessToken()
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!user) return null
      try {
        return (
          (forceRefreshToken ? await refresh() : await getAccessToken()) ?? null
        )
      } catch {
        return null
      }
    },
    [user, refresh, getAccessToken]
  )
  return {
    isLoading: loading,
    isAuthenticated: Boolean(user),
    fetchAccessToken,
  }
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new ConvexReactClient(
        process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210"
      )
  )
  return (
    <AuthKitProvider>
      <ConvexProviderWithAuth client={client} useAuth={useAuthFromAuthKit}>
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  )
}
