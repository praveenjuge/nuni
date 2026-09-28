/** Best-effort React component name for an element (dev and most prod builds). */
export function reactComponentName(el: Element): string | undefined {
  const key = Object.keys(el).find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
  )
  if (!key) return undefined
  type Fiber = { type?: unknown; return?: Fiber | null }
  let fiber = (el as unknown as Record<string, Fiber>)[key] ?? null
  for (let i = 0; fiber && i < 30; i++) {
    const type = fiber.type as
      | { displayName?: string; name?: string; render?: { name?: string } }
      | string
      | undefined
    if (type && typeof type !== "string") {
      const name = type.displayName || type.name || type.render?.name
      if (name && name.length > 2 && /^[A-Z]/.test(name)) return name
    }
    fiber = fiber.return ?? null
  }
  return undefined
}
