import { cronJobs } from "convex/server"

import { internal } from "./_generated/api"

const crons = cronJobs()

crons.daily(
  "delete expired widget sessions",
  { hourUTC: 3, minuteUTC: 17 },
  internal.sessions.cleanupExpired
)

crons.daily(
  "delete unfinished CLI logins",
  { hourUTC: 3, minuteUTC: 29 },
  internal.cliAuth.cleanupExpired
)

crons.daily(
  "delete expired transfer links",
  { hourUTC: 3, minuteUTC: 41 },
  internal.transfers.cleanupExpired
)

export default crons
