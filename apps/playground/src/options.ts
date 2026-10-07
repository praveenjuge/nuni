import type { NuniProps } from "@nuniapp/react"

// Public project ID for local development. Safe to commit.
// `?project=nuni_...` switches projects (used by the e2e tests).
export const PROJECT_ID = (() => {
  const fromUrl = new URLSearchParams(location.search).get("project")
  if (fromUrl) sessionStorage.setItem("playground:project", fromUrl)
  return (
    sessionStorage.getItem("playground:project") ??
    "nuni_JJHAES8DaHHYNVh4JoWWXw"
  )
})()

// Widget options from the URL, for trying them out (and for the e2e tests):
// `?position=top-left&accent=%23facc15&theme=dark&label=Feedback&hotkey=f`.
export const OPTIONS = (() => {
  const q = new URLSearchParams(location.search)
  const get = (name: string) => q.get(name) ?? undefined
  return {
    position: get("position") as NuniProps["position"],
    accentColor: get("accent"),
    theme: get("theme") as NuniProps["theme"],
    label: get("label"),
    hotkey: q.get("hotkey") === "off" ? (false as const) : get("hotkey"),
    locale: get("locale"),
  }
})()

/** Local backend overrides, set by the e2e suite. */
export const BACKEND = {
  convexUrl: import.meta.env.VITE_CONVEX_URL,
  convexSiteUrl: import.meta.env.VITE_CONVEX_SITE_URL,
  appUrl: import.meta.env.VITE_APP_URL,
}
