/**
 * Every error code the backend sends, with the HTTP status its HTTP routes
 * answer with. Functions throw `ConvexError({ code, message })`; HTTP routes
 * send the same `{ code, message }` as JSON. Clients branch on the code and
 * may show the message.
 */
export const ERROR_STATUS = {
  invalid: 400,
  bad_json: 400,
  invalid_author: 400,
  invalid_body: 400,
  invalid_name: 400,
  invalid_origin: 400,
  invalid_page: 400,
  invalid_project: 400,
  invalid_reaction: 400,
  invalid_suggestion: 400,
  too_many: 400,
  unknown_origin: 400,
  deleting: 400,
  already_owner: 400,
  signed_out: 400,
  unauthenticated: 400,
  forbidden: 403,
  cap_reached: 403,
  not_found: 404,
  conflict: 409,
  expired: 410,
  too_large: 413,
  invalid_type: 415,
  rate_limited: 429,
  server_error: 500,
} as const

export type ErrorCode = keyof typeof ERROR_STATUS

export interface ErrorData {
  code: ErrorCode
  message: string
}

/** The `{ code, message }` a Convex function threw, if it threw one. */
export function errorData(error: unknown): Partial<ErrorData> {
  const data: unknown = (error as { data?: unknown } | null)?.data
  return data && typeof data === "object" ? (data as Partial<ErrorData>) : {}
}

/**
 * What to tell the person about a failed call: the backend's message, else
 * the error's own, else `fallback`.
 */
export function errorMessage(error: unknown, fallback: string): string {
  const { message } = errorData(error)
  if (message) return message
  return error instanceof Error ? error.message : fallback
}
