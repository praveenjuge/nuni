export interface PageLocation {
  origin: string
  path: string
  search: string
  hash: string
  url: string
}

/**
 * Normalize a URL to the key comments are matched by. Query and hash are
 * ignored, except hash-router paths like `#/settings`.
 */
export function normalizePath(input: string | URL): string {
  const url = typeof input === "string" ? new URL(input) : input
  let path = url.pathname

  if (url.hash.startsWith("#/") || url.hash.startsWith("#!/")) {
    const hashPath = url.hash.replace(/^#!?/, "").split("?")[0] ?? "/"
    path = joinPath(path, hashPath)
  }

  try {
    path = decodeURI(path)
  } catch {
    // keep the raw path when it is not valid percent-encoding
  }
  path = path.replace(/\/index\.html?$/i, "/")
  path = path.replace(/\/{2,}/g, "/")
  if (path.length > 1 && !path.includes("#")) path = path.replace(/\/$/, "")
  return path || "/"
}

function joinPath(base: string, hashPath: string): string {
  const cleanBase = base.replace(/\/index\.html?$/i, "/").replace(/\/$/, "")
  const route = hashPath.length > 1 ? hashPath.replace(/\/$/, "") : hashPath
  return `${cleanBase}/#${route}`
}

export function describeLocation(input: string | URL): PageLocation {
  const url = typeof input === "string" ? new URL(input) : input
  return {
    origin: url.origin,
    path: normalizePath(url),
    search: url.search,
    hash: url.hash,
    url: url.href,
  }
}

export function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost")
    )
  } catch {
    return false
  }
}

/** URL that opens the page with the comment focused by the widget. */
export function commentUrl(
  page: { origin: string; path: string; search?: string },
  id: string
): string {
  const [pathname, hashRoute] = page.path.split("#")
  const origin = new URL(page.origin).origin
  let url = new URL(pathname ?? "/", origin)
  // Paths come from visitors: "//other.host/x" must not leave the page's origin.
  if (url.origin !== origin) url = new URL("/", origin)
  const params = new URLSearchParams(page.search ?? "")
  params.set("nuni", id)
  url.search = params.toString()
  if (hashRoute) url.hash = hashRoute
  return url.toString()
}

/** Origin + path only: query strings and hashes often carry tokens. */
export function withoutQuery(input: string, base?: string): string {
  try {
    const url = new URL(input, base)
    return `${url.origin}${url.pathname}`
  } catch {
    return input.split(/[?#]/)[0] ?? ""
  }
}

/** Remove query strings and hashes from every URL inside free text (log lines). */
export function stripUrlQueries(text: string): string {
  return text.replace(/(\bhttps?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, "$1")
}

const URL_ATTRIBUTES =
  /(\s(?:href|src|srcset|action|formaction|poster|cite|ping|data|background)\s*=\s*)("[^"]*"|'[^']*')/gi

/**
 * Remove query strings and hashes from URL attributes in serialized HTML
 * (links, images, srcset lists), relative or absolute.
 */
export function stripHtmlUrlQueries(html: string): string {
  return html.replace(URL_ATTRIBUTES, (_all, name: string, quoted: string) => {
    const quote = quoted[0]
    const value = quoted.slice(1, -1).replace(/[?#][^\s,]*/g, "")
    return `${name}${quote}${value}${quote}`
  })
}
