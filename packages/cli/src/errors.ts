import type { ErrorCode } from "@nuni/shared"

/**
 * Something to tell the person (or agent) running the CLI, as opposed to a
 * bug. `code` is the backend's error code when it came from Nuni, `network`
 * when Nuni couldn't be reached, and unset for bad input.
 */
export class NuniError extends Error {
  constructor(
    message: string,
    readonly code?: ErrorCode | "network"
  ) {
    super(message)
  }
}

/**
 * The message as a sentence, then `loginHint` when the session is missing,
 * expired or revoked. The CLI and the MCP server word the hint for their
 * reader.
 */
export function describeError(error: NuniError, loginHint: string): string {
  const sentence = /\w$/.test(error.message)
    ? `${error.message}.`
    : error.message
  return error.code === "unauthenticated"
    ? `${sentence} ${loginHint}`
    : sentence
}
