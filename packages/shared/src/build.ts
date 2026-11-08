/** The local backend and dashboard a development build talks to. */
export const DEV_URLS = {
  convex: "http://127.0.0.1:3210",
  convexSite: "http://127.0.0.1:3211",
  app: "http://localhost:3000",
} as const

/**
 * The `__NUNI_*__` URLs the widget and CLI builds replace (declare them in
 * the package's own code): from the NUNI_* env vars, else the local ones. A
 * release build (NUNI_RELEASE=1) must set every env var.
 */
export function urlDefines(
  env: Record<string, string | undefined>
): Record<string, string> {
  const value = (name: string, fallback: string) => {
    const set = env[name]
    if (set) return set
    if (env.NUNI_RELEASE === "1") {
      throw new Error(`${name} must be set for a release build`)
    }
    return fallback
  }
  return {
    __NUNI_CONVEX_URL__: JSON.stringify(
      value("NUNI_CONVEX_URL", DEV_URLS.convex)
    ),
    __NUNI_CONVEX_SITE_URL__: JSON.stringify(
      value("NUNI_CONVEX_SITE_URL", DEV_URLS.convexSite)
    ),
    __NUNI_APP_URL__: JSON.stringify(value("NUNI_APP_URL", DEV_URLS.app)),
  }
}
