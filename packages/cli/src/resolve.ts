import type { Remote } from "./remote"

export interface ResolveResult {
  resolved: string[]
  failed: { id: string; error: string }[]
  /** Resolved, but the note couldn't be posted; retry it with reply. */
  noteFailed: { id: string; error: string }[]
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/**
 * Resolve comments one by one, each with the note as a reply. One that fails
 * (deleted, not in this project) doesn't stop the rest.
 */
export async function resolveComments(
  remote: Remote,
  session: { publicId: string; token: string },
  ids: string[],
  note?: string
): Promise<ResolveResult> {
  const result: ResolveResult = { resolved: [], failed: [], noteFailed: [] }
  for (const id of [...new Set(ids)]) {
    // The status first, so a note is never left on a comment that stayed open.
    try {
      await remote.setStatus(session.token, id, "resolved")
    } catch (error) {
      result.failed.push({ id, error: message(error) })
      continue
    }
    result.resolved.push(id)
    if (!note?.trim()) continue
    try {
      await remote.reply(session.publicId, session.token, id, note.trim())
    } catch (error) {
      result.noteFailed.push({ id, error: message(error) })
    }
  }
  return result
}

export function formatResolveResult({
  resolved,
  failed,
  noteFailed,
}: ResolveResult) {
  return [
    resolved.length ? `Resolved ${resolved.join(", ")}.` : "",
    ...failed.map((f) => `Couldn't resolve ${f.id}: ${f.error}`),
    ...noteFailed.map(
      (f) => `Resolved ${f.id}, but couldn't post the note: ${f.error}`
    ),
  ]
    .filter(Boolean)
    .join("\n")
}
