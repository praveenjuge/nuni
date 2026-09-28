export const BASE_PATH = "/dashboard"

/** Public origin the dashboard is served from (behind the docs-site rewrite in production). */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")

/** Only allow redirects back into the dashboard. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith(`${BASE_PATH}`) || value.startsWith("//")) return BASE_PATH
  return value
}
