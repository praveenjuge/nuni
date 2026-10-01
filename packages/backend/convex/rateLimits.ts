import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter"

import { components } from "./_generated/api"

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  commentPerIp: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 10,
  },
  commentPerProject: {
    kind: "token bucket",
    rate: 60,
    period: MINUTE,
    capacity: 60,
  },
  touchPerProject: {
    kind: "token bucket",
    rate: 100,
    period: MINUTE,
    capacity: 100,
  },
  screenshotPerIp: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 10,
  },
  cliLoginPerIp: { kind: "token bucket", rate: 10, period: HOUR },
  /** The CLI polls every 2 seconds while it waits for approval. */
  cliPollPerIp: {
    kind: "token bucket",
    rate: 60,
    period: MINUTE,
    capacity: 60,
  },
  editPerAuthor: { kind: "token bucket", rate: 30, period: MINUTE },
  sessionPerUser: { kind: "token bucket", rate: 20, period: HOUR },
})
