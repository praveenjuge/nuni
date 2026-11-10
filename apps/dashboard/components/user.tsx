"use client"

import { api } from "@nuni/backend/api"
import { useAction, useConvexAuth } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

import { SignedOut } from "@/components/signed-out"
import { Button } from "@/components/ui/button"
import { errorMessage } from "@/lib/format"

/** The signed-in person, as their comments and the header show them. */
export type Me = FunctionReturnType<typeof api.users.storeFresh>

type UserState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "ready"; me: Me }
  | { status: "error"; message: string; retry: () => void }

const UserContext = createContext<UserState>({ status: "loading" })

/**
 * Brings the signed-in person's Convex row up to date once per page load.
 * Every query that needs the row renders inside `SignedIn`, so none of them
 * can run before it exists.
 */
export function UserProvider({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const storeFresh = useAction(api.users.storeFresh)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ me: Me } | { message: string } | null>(
    null
  )

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    storeFresh({}).then(
      (me) => !cancelled && setResult({ me }),
      (error) => !cancelled && setResult({ message: errorMessage(error) })
    )
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, storeFresh, attempt])

  const state: UserState =
    !isAuthenticated || !result
      ? { status: isLoading || isAuthenticated ? "loading" : "signed_out" }
      : "me" in result
        ? { status: "ready", me: result.me }
        : {
            status: "error",
            message: result.message,
            retry: () => {
              setResult(null)
              setAttempt((n) => n + 1)
            },
          }
  return <UserContext value={state}>{children}</UserContext>
}

/** Renders `children` once the signed-in person's row is ready. */
export function SignedIn({
  children,
  fallback,
}: {
  children: ReactNode
  fallback: ReactNode
}) {
  const user = useContext(UserContext)
  if (user.status === "ready") return children
  if (user.status === "signed_out") return <SignedOut />
  if (user.status === "loading") return fallback
  return (
    <div
      role="alert"
      className="mx-auto grid max-w-sm justify-items-center gap-3 py-16 text-center"
    >
      <p className="font-medium">Couldn&apos;t load your account</p>
      <p className="text-sm text-muted-foreground">{user.message}</p>
      <Button variant="outline" size="sm" onClick={user.retry}>
        Try again
      </Button>
    </div>
  )
}

/** The signed-in person, or null until `SignedIn` would render. */
export function useMaybeMe(): Me | null {
  const user = useContext(UserContext)
  return user.status === "ready" ? user.me : null
}

/** The signed-in person. Only inside `SignedIn`. */
export function useMe(): Me {
  const me = useMaybeMe()
  if (!me) throw new Error("useMe is only for components inside SignedIn")
  return me
}
