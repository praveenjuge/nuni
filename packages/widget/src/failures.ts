import { LIMITS, type ErrorCode } from "@nuni/shared"

import type { I18n, MessageKey } from "./i18n"

/** Why a call failed: a backend error code, or no answer at all. */
export type FailureCode = ErrorCode | "network" | "unknown"

/** Messages by failure code: a code the backend renames stops compiling. */
export type FailureMessages = Partial<Record<FailureCode, MessageKey>>

/**
 * What a failed call means to a visitor, by the backend's error code (see
 * `ERROR_STATUS` in @nuni/shared). Other codes get the message of the
 * action that failed ("Couldn't post the comment").
 */
const FAILURES: FailureMessages = {
  network: "offline",
  rate_limited: "slowDown",
  signed_out: "signInAgain",
  unauthenticated: "signInAgain",
  forbidden: "notAllowed",
  not_found: "gone",
  deleting: "projectDeleting",
  cap_reached: "threadFull",
  conflict: "tooManyImages",
  invalid_type: "imageUnreadable",
  too_large: "imageTooLarge",
  expired: "tooLate",
  invalid_body: "writeFirst",
  invalid_name: "enterName",
  invalid_suggestion: "changeTextFirst",
}

/**
 * What to tell the visitor when `action` failed with an error `code`:
 * what the code means, else the action's own message. `overrides` are for
 * an action where a code means something more specific.
 */
export function failed(
  t: I18n["t"],
  code: FailureCode,
  action: MessageKey,
  overrides: FailureMessages = {}
): string {
  return t(overrides[code] ?? FAILURES[code] ?? action, {
    count: LIMITS.imagesPerComment,
  })
}
