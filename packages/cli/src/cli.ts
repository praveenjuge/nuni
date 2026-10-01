import { resolve } from "node:path"
import { parseArgs } from "node:util"

import packageJson from "../package.json"

import {
  buildAgentPrompt,
  DOCS_URL,
  generateProjectId,
  isProjectId,
  PACKAGES,
} from "@nuni/shared"

import {
  CommandError,
  listComments,
  login,
  logout,
  setStatus,
  showComment,
  whoami,
  type CommandContext,
} from "./commands"
import { detectFramework, detectPackageManager, installCommand } from "./detect"
import { createMcpServer, serveStdio } from "./mcp"
import { ProjectError } from "./project"
import { createRemote, RemoteError, type Remote } from "./remote"
import { packageFor, snippetFor } from "./snippets"

const VERSION = packageJson.version

const HELP = `nuni ${VERSION}: pinned comments on your live site

Usage
  npx @nuniapp/cli@latest init [--id <project-id>] [--cwd <dir>] [--json]
  npx @nuniapp/cli@latest prompt [--id <project-id>]
  npx @nuniapp/cli@latest id

  npx @nuniapp/cli@latest login              sign in to this project's comments
  npx @nuniapp/cli@latest comments [--status open|resolved] [--page /path] [--limit 20]
  npx @nuniapp/cli@latest comment <id> [--save-screenshot <dir>]
  npx @nuniapp/cli@latest resolve <id>
  npx @nuniapp/cli@latest reopen <id>
  npx @nuniapp/cli@latest whoami | logout
  npx @nuniapp/cli@latest mcp                MCP server for coding agents (stdio)

Commands
  init      Generate a project ID and print the install steps for this project
  prompt    Print the ready-made prompt for Codex, Claude Code, Cursor, etc.
  id        Print a new project ID
  login     Approve this terminal in the Nuni dashboard (works over SSH too)
  comments  List comments, newest first
  comment   One comment with the element, DOM, styles, console and screenshot
  resolve   Mark a comment resolved; reopen does the opposite
  mcp       Run the MCP server: claude mcp add nuni -- npx -y @nuniapp/cli@latest mcp

The project comes from --project, $NUNI_PROJECT, or the nuni_ ID in your code.
Add --json to any command for machine-readable output.

Docs: ${DOCS_URL}`

const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[22m` : s)
const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[22m` : s)

const OPTIONS = {
  id: { type: "string" },
  project: { type: "string", short: "p" },
  cwd: { type: "string" },
  status: { type: "string" },
  page: { type: "string" },
  limit: { type: "string" },
  "save-screenshot": { type: "string" },
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", short: "v", default: false },
} as const

const ACCOUNT_COMMANDS = new Set([
  "login",
  "logout",
  "whoami",
  "comments",
  "comment",
  "resolve",
  "reopen",
  "mcp",
])

export interface RunOptions {
  remote?: Remote
  out?: (line: string) => void
  err?: (line: string) => void
  pollMs?: number
  openBrowser?: (url: string) => void
}

export async function run(
  argv: string[],
  options: RunOptions = {}
): Promise<number> {
  let parsed
  try {
    parsed = parse(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
  const { values, positionals } = parsed
  const command = positionals[0] ?? "init"

  if (ACCOUNT_COMMANDS.has(command) && !values.help) {
    return runAccountCommand(command, positionals[1], values, options)
  }

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

function parse(argv: string[]) {
  return parseArgs({ args: argv, allowPositionals: true, options: OPTIONS })
}

type Values = ReturnType<typeof parse>["values"]

async function runAccountCommand(
  command: string,
  arg: string | undefined,
  values: Values,
  options: RunOptions
): Promise<number> {
  const ctx: CommandContext = {
    remote: options.remote ?? createRemote(),
    version: VERSION,
    cwd: resolve(values.cwd ?? process.cwd()),
    project: values.project ?? values.id,
    json: values.json,
    out: options.out ?? ((line) => console.log(line)),
    err: options.err ?? ((line) => console.error(line)),
    pollMs: options.pollMs,
    openBrowser: options.openBrowser,
  }
  try {
    switch (command) {
      case "login":
        return await login(ctx)
      case "logout":
        return await logout(ctx)
      case "whoami":
        return await whoami(ctx)
      case "comments":
        return await listComments(ctx, values)
      case "comment":
        return await showComment(ctx, arg, {
          saveScreenshot: values["save-screenshot"],
        })
      case "resolve":
        return await setStatus(ctx, arg, "resolved")
      case "reopen":
        return await setStatus(ctx, arg, "open")
      default: {
        const server = createMcpServer({
          remote: ctx.remote,
          version: VERSION,
          project: ctx.project,
          cwd: ctx.cwd,
        })
        await serveStdio(server)
        return 0
      }
    }
  } catch (error) {
    if (
      error instanceof CommandError ||
      error instanceof ProjectError ||
      error instanceof RemoteError
    ) {
      const hint =
        error instanceof RemoteError && error.code === "unauthenticated"
          ? ` Run \`npx ${PACKAGES.cli}@latest login\`.`
          : ""
      ctx.err(`${error.message.replace(/\.$/, "")}.${hint}`)
      return 1
    }
    throw error
  }
}
