import { init } from "@nuniapp/widget"
import { useEffect } from "react"

export const client = "only"

// The docs site uses Nuni on itself. Public ID, safe to commit.
const DOCS_PROJECT_ID = "nuni_mknC4w74AuwQ1ez5cCG8Tv"

export default function NuniWidget() {
  useEffect(() => init({ project: DOCS_PROJECT_ID }).destroy, [])
  return null
}
