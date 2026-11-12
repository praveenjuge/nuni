import type { EmailFrequency } from "./types"

/**
 * How often a project's owner is emailed about new activity. One email per
 * period, and only when something happened in it.
 */
export const EMAIL_FREQUENCIES = [
  "off",
  "hourly",
  "daily",
  "weekly",
] as const satisfies readonly EmailFrequency[]

/** What a project uses until its owner picks a frequency. */
export const DEFAULT_EMAIL_FREQUENCY: EmailFrequency = "daily"

/** Daily and weekly emails go out at this hour (UTC); weekly ones on Monday. */
export const EMAIL_SEND_HOUR_UTC = 8
