import { optionsFromAttributes } from "@nuniapp/widget"

const query = Object.fromEntries(new URLSearchParams(location.search))

/**
 * `?project=nuni_...` picks the project (every e2e test passes its own);
 * without it, this public development ID (safe to commit).
 */
export const PROJECT_ID = query.project ?? "nuni_JJHAES8DaHHYNVh4JoWWXw"

/**
 * Widget options from the URL, named like the script tag's data attributes
 * (for trying them out, and for the e2e tests):
 * `?position=top-left&accentColor=%23facc15&theme=dark&label=Feedback&hotkey=f`.
 */
export const OPTIONS = optionsFromAttributes(query)

/** Local backend overrides, set by the e2e suite. */
export const BACKEND = {
  convexUrl: import.meta.env.VITE_CONVEX_URL,
  convexSiteUrl: import.meta.env.VITE_CONVEX_SITE_URL,
  appUrl: import.meta.env.VITE_APP_URL,
}
