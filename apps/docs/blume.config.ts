import { readFileSync } from "node:fs"

import {
  CDN_URL,
  CLI_NPX,
  DASHBOARD_ROUTES,
  DOCS_URL,
  LIMITS,
  MCP_ADD_COMMAND,
  PACKAGES,
  dashboardUrl,
} from "@nuni/shared"
import { defineConfig } from "blume"

const DAY = 24 * 60 * 60 * 1000
const days = (ms: number) => String(ms / DAY)

/** The CDN script's size budget, which CI enforces. */
const cdnBudget = (
  JSON.parse(
    readFileSync(
      new URL("../../packages/widget/.size-limit.json", import.meta.url),
      "utf8"
    )
  ) as { path: string; limit: string }[]
).find((entry) => entry.path === "dist/nuni.global.js")!.limit

export default defineConfig({
  title: "Nuni",
  description:
    "Pin a comment to anything on your site. Talk it through with your team. Give your agent the context.",
  logo: { image: "/logo.svg", text: "Nuni" },
  theme: {
    accent: "#d6246e",
    radius: "lg",
    mode: "system",
    fonts: { display: "geist", body: "geist", mono: "geist-mono" },
  },
  navigation: {
    cta: {
      label: "Sign in",
      href: dashboardUrl(DOCS_URL, DASHBOARD_ROUTES.signIn),
    },
  },
  // Values the pages state, from the code that decides them: `{{name}}`.
  variables: {
    cli: CLI_NPX,
    "cli-package": PACKAGES.cli,
    "mcp-add": MCP_ADD_COMMAND,
    "cdn-url": CDN_URL,
    "cdn-budget": cdnBudget,
    "session-days": days(LIMITS.sessionTtlMs),
    "cli-session-days": days(LIMITS.cliSessionTtlMs),
    "transfer-days": days(LIMITS.transferTtlMs),
    "unclaimed-cap": String(LIMITS.unclaimedCommentCap),
    "images-per-comment": String(LIMITS.imagesPerComment),
    "agent-list-default": String(LIMITS.agentListDefault),
    "bulk-max": String(LIMITS.bulkMax),
  },
  github: {
    owner: "praveenjuge",
    repo: "nuni",
    branch: "main",
    dir: "apps/docs",
  },
  lastModified: "git",
  seo: {
    software: {
      license: "MIT",
      price: 0,
      sameAs: [
        "https://github.com/praveenjuge/nuni",
        ...Object.values(PACKAGES).map(
          (name) => `https://www.npmjs.com/package/${name}`
        ),
      ],
    },
  },
  agents: { llmsTxt: true },
  deployment: { site: DOCS_URL },
})
