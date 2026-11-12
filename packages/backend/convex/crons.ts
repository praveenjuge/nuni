import { cronJobs } from "convex/server"

import { internal } from "./_generated/api"

const crons = cronJobs()

crons.daily(
  "delete expired sessions, CLI logins and transfer links",
  { hourUTC: 3, minuteUTC: 17 },
  internal.tokens.cleanupExpired
)

// On the hour, which is when hourly, daily and weekly emails are all due.
crons.hourly(
  "send activity emails that are due",
  { minuteUTC: 0 },
  internal.digests.sendDue
)

export default crons
