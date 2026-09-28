export const BASE_PATH = "/dashboard"

/**
 * Public origin the dashboard is served from: https://nuni.praveenjuge.com in
 * production (the dashboard sits behind the docs site's /dashboard rewrite),
 * http://localhost:3000 locally.
 */
export const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
).replace(/\/$/, "")

export const REDIRECT_URI =
  process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ??
  `${APP_URL}${BASE_PATH}/callback`

/** Only allow redirects back into the dashboard. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith(`${BASE_PATH}`) || value.startsWith("//"))
    return BASE_PATH
  return value
}
