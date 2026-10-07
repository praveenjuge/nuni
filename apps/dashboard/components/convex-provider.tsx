"use client"

import {
  AuthKitProvider,
  useAccessToken,
  useAuth,
} from "@workos-inc/authkit-nextjs/components"
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react"
import { useCallback, useRef, useState, type ReactNode } from "react"

function useAuthFromAuthKit() {
  const { user, loading } = useAuth()
  const { getAccessToken, refresh } = useAccessToken()
  const lastToken = useRef<string | null>(null)
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!user) return null
      try {
        // Each refresh rotates the single-use WorkOS refresh token, and a
        // response cut off by a reload leaves the browser holding a dead one.
        // getAccessToken() already refreshes near expiry, so force a refresh
        // only when Convex rejected the token it would hand back.
        let token = (await getAccessToken()) ?? null
        if (forceRefreshToken && token === lastToken.current)
          token = (await refresh()) ?? null
        lastToken.current = token
        return token
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
        process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210",
        // Keep the token from page load instead of refreshing right away.
        { initialAuthTokenReuse: true }
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
