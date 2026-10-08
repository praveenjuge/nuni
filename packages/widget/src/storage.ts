/** localStorage that never throws (private mode, blocked storage, sandboxed iframes). */
const memory = new Map<string, string>()

export function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return memory.get(key) ?? null
  }
}

export function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    if (value === null) memory.delete(key)
    else memory.set(key, value)
  }
}

export const KEYS = {
  name: "nuni:name",
  secret: "nuni:author-secret",
  session: (project: string) => `nuni:session:${project}`,
  /** Where this visitor dragged the toolbar. */
  position: (project: string) => `nuni:position:${project}`,
  /** The comment this visitor opened last, marked in the panel. */
  lastViewed: (project: string) => `nuni:last-viewed:${project}`,
} as const
