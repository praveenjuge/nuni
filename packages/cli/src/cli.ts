import { resolve } from "node:path"
import { parseArgs } from "node:util"

import {
  buildAgentPrompt,
  DOCS_URL,
  generateProjectId,
  isProjectId,
} from "@nuni/shared"

import { detectFramework, detectPackageManager, installCommand } from "./detect"
import { packageFor, snippetFor } from "./snippets"

const VERSION = "0.1.0"

const HELP = `nuni ${VERSION}: pinned comments on your live site

Usage
  npx @nuni/cli init [--id <project-id>] [--cwd <dir>] [--json]
  npx @nuni/cli prompt [--id <project-id>]
  npx @nuni/cli id

Commands
  init     Generate a project ID and print the install steps for this project
  prompt   Print the ready-made prompt for Codex, Claude Code, Cursor, etc.
  id       Print a new project ID

Docs: ${DOCS_URL}`

const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[22m` : s)
const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[22m` : s)

export function run(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      id: { type: "string" },
      cwd: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  })
  const command = positionals[0] ?? "init"

  if (values.version) {
    console.log(VERSION)
    return 0
  }
  if (values.help || command === "help") {
    console.log(HELP)
    return 0
  }
  if (values.id && !isProjectId(values.id)) {
    console.error(
      `"${values.id}" is not a valid Nuni project ID (expected nuni_ followed by 22 characters).`
    )
    return 1
  }
  const projectId = values.id ?? generateProjectId()

  if (command === "id") {
    console.log(projectId)
    return 0
  }
  if (command === "prompt") {
    console.log(buildAgentPrompt({ projectId }))
    return 0
  }
  if (command !== "init") {
    console.error(`Unknown command "${command}".\n\n${HELP}`)
    return 1
  }

  const cwd = resolve(values.cwd ?? process.cwd())
  const framework = detectFramework(cwd)
  const pm = detectPackageManager(cwd)
  const pkg = packageFor(framework)
  const install = pkg ? installCommand(pm, pkg) : null
  const snippet = snippetFor(framework, projectId)

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          projectId,
          framework: framework.name,
          frameworkId: framework.id,
          file: framework.file,
          package: pkg,
          install,
          snippet,
        },
        null,
        2
      )
    )
    return 0
  }

  console.log(`
${bold("Nuni")} ${dim(`v${VERSION}`)}

${bold("Project ID")}   ${projectId}
${dim("Public, safe to commit. Keep using this same ID on every environment.")}

${bold("Detected")}     ${framework.name}${pkg ? ` (${pm})` : ""}
${install ? `\n${bold("1. Install")}\n   ${install}\n` : ""}
${bold(`${install ? "2" : "1"}. Add it once, globally`)} ${dim(`(${framework.file})`)}

${snippet
  .split("\n")
  .map((line) => `   ${line}`)
  .join("\n")}

${bold(`${install ? "3" : "2"}. Open the site`)}
   Start the dev server. A Nuni button appears in the bottom-right corner.
   Press C, click anything, leave a comment. No account needed.

${bold("Own this site?")} Open the Nuni panel and choose "Claim Nuni" to sign in with GitHub.
${dim(`Docs: ${DOCS_URL}`)}
`)
  return 0
}
