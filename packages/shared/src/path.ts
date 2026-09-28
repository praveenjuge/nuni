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
