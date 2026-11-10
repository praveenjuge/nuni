import { cronJobs } from "convex/server"

import { internal } from "./_generated/api"

const crons = cronJobs()

crons.daily(
  "delete expired sessions, CLI logins and transfer links",
  { hourUTC: 3, minuteUTC: 17 },
  internal.tokens.cleanupExpired
)

export default crons
