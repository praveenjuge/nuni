export interface AnchorOptions {
  /** Elements that must never be captured or matched (e.g. Nuni's own UI). */
  isIgnored?: (el: Element) => boolean
  /** Attribute prefixes that must never be read (e.g. benchmark markers). */
  ignoreAttributePrefixes?: string[]
}

export function attributeAllowed(name: string, options: AnchorOptions): boolean {
  const prefixes = options.ignoreAttributePrefixes
  return !prefixes || !prefixes.some((p) => name.startsWith(p))
}
