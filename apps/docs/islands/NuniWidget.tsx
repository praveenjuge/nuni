import { init } from "@nuniapp/widget"
import { useEffect } from "react"

export const client = "only"

// The docs site uses Nuni on itself. Public ID, safe to commit.
const DOCS_PROJECT_ID = "nuni_mknC4w74AuwQ1ez5cCG8Tv"

export default function NuniWidget() {
  useEffect(
    () =>
      init({
        project: DOCS_PROJECT_ID,
        convexUrl: import.meta.env.PUBLIC_NUNI_CONVEX_URL,
        convexSiteUrl: import.meta.env.PUBLIC_NUNI_CONVEX_SITE_URL,
        appUrl: import.meta.env.PUBLIC_NUNI_APP_URL,
      }).destroy,
    []
  )
  return null
}
