import type { Remote } from "./remote"

export interface ResolveResult {
  resolved: string[]
  failed: { id: string; error: string }[]
}

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
  const result: ResolveResult = { resolved: [], failed: [] }
  for (const id of [...new Set(ids)]) {
    try {
      // The status first, so a note is never left on a comment that stayed open.
      await remote.setStatus(session.token, id, "resolved")
      if (note?.trim()) {
        await remote.reply(session.publicId, session.token, id, note.trim())
      }
      result.resolved.push(id)
    } catch (error) {
      result.failed.push({
        id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return result
}

export function formatResolveResult({ resolved, failed }: ResolveResult) {
  return [
    resolved.length ? `Resolved ${resolved.join(", ")}.` : "",
    ...failed.map((f) => `Couldn't resolve ${f.id}: ${f.error}`),
  ]
    .filter(Boolean)
    .join("\n")
}
