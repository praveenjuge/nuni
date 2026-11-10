/**
 * Keeps the agent prompt in the published READMEs identical to the one in
 * @nuni/shared (also used by the CLI and the docs site).
 *
 *   bun scripts/sync-readmes.ts          # write
 *   bun scripts/sync-readmes.ts --check  # fail if out of date (CI)
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { buildAgentPrompt } from "@nuni/shared"

import { publicPackages } from "./public-packages"

const START = "<!-- prompt:start -->"
const END = "<!-- prompt:end -->"
const block = `${START}\n\n\`\`\`text\n${buildAgentPrompt()}\n\`\`\`\n\n${END}`

let stale = false
for (const { dir } of publicPackages()) {
  const file = join(dir, "README.md")
  const content = readFileSync(file, "utf8")
  const start = content.indexOf(START)
  const end = content.indexOf(END)
  if (start === -1 || end === -1)
    throw new Error(`${file} is missing prompt markers`)
  const next = content.slice(0, start) + block + content.slice(end + END.length)
  if (next !== content) {
    stale = true
    if (!process.argv.includes("--check")) writeFileSync(file, next)
  }
}
if (stale && process.argv.includes("--check")) {
  console.error("READMEs are out of date. Run: bun scripts/sync-readmes.ts")
  process.exit(1)
}
