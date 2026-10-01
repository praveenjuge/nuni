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

/**
 * Cut a word of free text at the query or hash of the URL in it: after a
 * path ("/reset?token=1", "https://a.com/x#t") or before a key=value pair
 * ("?token=1", "#access_token=1"). One pass, so long words stay cheap.
 */
function stripWord(word: string): string {
  const slash = word.indexOf("/")
  const equals = word.lastIndexOf("=")
  for (let i = 0; i < word.length - 1; i++) {
    const c = word[i]
    if ((c === "?" || c === "#") && ((slash >= 0 && slash < i) || equals > i))
      return word.slice(0, i)
  }
  return word
}

/**
 * Remove query strings and hashes from every URL inside free text (log
 * lines, markup, CSS values), absolute or relative.
 */
export function stripUrlQueries(text: string): string {
  return text.replace(/[^\s"'<>`]+/g, stripWord)
}

const ATTRIBUTE = /(\s([^\s"'<>/=]+)\s*=\s*)("[^"]*"|'[^']*')/g
/** Attributes that hold URLs, including lazy-loading ones like data-src. */
const URL_ATTRIBUTE =
  /^(?:action|formaction|poster|cite|ping|data|background|(?:[\w-]*[-:])?(?:href|src|srcset|url|uri))$/i

/**
 * Remove query strings and hashes from serialized HTML: URL attributes
 * (links, images, srcset lists, data-src) always, relative or absolute,
 * and URLs anywhere else (inline styles, other attributes, text).
 */
export function stripHtmlUrlQueries(html: string): string {
  const attributes = html.replace(
    ATTRIBUTE,
    (all, prefix: string, name: string, quoted: string) => {
      if (!URL_ATTRIBUTE.test(name)) return all
      const quote = quoted[0]
      const value = quoted.slice(1, -1)
      const clean = /srcset$/i.test(name)
        ? value.replace(/[?#][^\s,]*/g, "")
        : value.replace(/[?#][\s\S]*$/, "")
      return `${prefix}${quote}${clean}${quote}`
    }
  )
  return stripUrlQueries(attributes)
}
