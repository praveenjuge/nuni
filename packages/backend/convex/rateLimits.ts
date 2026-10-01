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
  replyPerIp: {
    kind: "token bucket",
    rate: 20,
    period: MINUTE,
    capacity: 20,
  },
  reactPerAuthor: {
    kind: "token bucket",
    rate: 60,
    period: MINUTE,
    capacity: 30,
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

/**
 * The key for a per-IP limit. On test deployments (NUNI_ALLOW_TESTING=1)
 * every e2e browser shares one address, so there the key also names the
 * project; each test uses its own project, so tests don't use up each
 * other's allowance. Production keys by address alone.
 */
export function ipKey(ip: string, publicId: string): string {
  return process.env.NUNI_ALLOW_TESTING === "1" ? `${ip} ${publicId}` : ip
}
