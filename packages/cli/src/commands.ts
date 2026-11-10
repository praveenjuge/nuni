import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  buildAgentPrompt,
  buildCommentPrompt,
  cliCommand,
  DOCS_URL,
  MCP_ADD_COMMAND,
  type CommentStatus,
} from "@nuni/shared"

import { VERSION } from "./env"
import { NuniError } from "./errors"
import {
  formatCommentList,
  formatPageList,
  formatStatusChange,
  STATUS_WORDS,
} from "./format"
import { detectSetup } from "./frameworks"
import { createMcpServer, serveStdio } from "./mcp"
import { GROUPS, oneOf, positiveInteger, STATUSES, type Ops } from "./ops"

/** What a command gets: the operations, its arguments, and the output. */
export interface Input {
  ops: Ops
  /** Positional arguments after the command name. */
  args: string[]
  flags: {
    cwd: string
    status?: string
    page?: string
    limit?: string
    search?: string
    group?: string
    note?: string
    saveScreenshot?: string
  }
  /** With --json: `data` on stdout. Otherwise `text` on stdout and each of `problems` on stderr. */
  print(data: unknown, text?: string, problems?: string[]): void
  style: { bold(s: string): string; dim(s: string): string }
  openBrowser(url: string): void
  pollMs?: number
}

export interface Command {
  name: string
  /** Arguments and flags, for the help. */
  usage?: string
  summary: string
  section: "Set up" | "Comments"
  /** The exit code. */
  run(input: Input): Promise<number>
}

/** What to do when there's no session, or it ended. */
export const LOGIN_HINT = `Run \`${cliCommand("login")}\`.`

/** Try to open the approval page, quietly: there may be no browser at all. */
export function openInBrowser(url: string) {
  if (!process.stdout.isTTY || process.env.CI || process.env.SSH_CONNECTION) {
    return
  }
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]]
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true })
    child.on("error", () => {})
    child.unref()
  } catch {
    // No browser; the URL is printed anyway.
  }
}

function needsId(id: string | undefined, usage: string): string {
  if (!id) throw new NuniError(`Pass a comment id: ${usage}`)
  return id
}

function initText(
  { style: { bold, dim } }: Input,
  setup: ReturnType<typeof detectSetup>
) {
  const { install } = setup
  return `
${bold("Nuni")} ${dim(`v${VERSION}`)}

${bold("Project ID")}   ${setup.projectId}
${dim("Public, safe to commit. Keep using this same ID on every environment.")}

${bold("Detected")}     ${setup.framework}${setup.package ? ` (${setup.packageManager})` : ""}
${install ? `\n${bold("1. Install")}\n   ${install}\n` : ""}
${bold(`${install ? "2" : "1"}. Add it once, globally`)} ${dim(`(${setup.file})`)}

${setup.snippet
  .split("\n")
  .map((line) => `   ${line}`)
  .join("\n")}

${bold(`${install ? "3" : "2"}. Open the site`)}
   Start the dev server. A Nuni button appears in the bottom-right corner.
   Press C, click anything, leave a comment. No account needed.

${bold("Own this site?")} Open the Nuni panel and choose "Claim Nuni" to sign in with GitHub.
${dim(`Docs: ${DOCS_URL}`)}
`
}

/** `resolve` and `reopen`: one operation, with a note, for 1..n ids. */
function statusCommand(status: CommentStatus, summary: string): Command {
  const { verb, done: past } = STATUS_WORDS[status]
  return {
    name: verb,
    usage: `<id...> [--note "what changed"]`,
    summary,
    section: "Comments",
    async run({ ops, args, flags, print }) {
      needsId(args[0], `${verb} <id...>`)
      const change = await ops.setStatus(args, status, flags.note)
      const { text, problems } = formatStatusChange(change)
      print(
        { [past.toLowerCase()]: change.done, failed: change.failed },
        text,
        problems
      )
      return change.failed.length ? 1 : 0
    },
  }
}

export const COMMANDS: Command[] = [
  {
    name: "init",
    usage: "[--id <project-id>] [--cwd <dir>]",
    summary:
      "Generate a project ID and print the install steps for this project",
    section: "Set up",
    async run(input) {
      const setup = detectSetup(input.flags.cwd, input.ops.projectIdForSetup())
      input.print(setup, initText(input, setup))
      return 0
    },
  },
  {
    name: "prompt",
    usage: "[--id <project-id>]",
    summary: "Print the ready-made prompt for Codex, Claude Code, Cursor, etc.",
    section: "Set up",
    async run({ ops, print }) {
      const projectId = ops.projectIdForSetup()
      const prompt = buildAgentPrompt({ projectId })
      print({ projectId, prompt }, prompt)
      return 0
    },
  },
  {
    name: "id",
    summary: "Print a new project ID",
    section: "Set up",
    async run({ ops, print }) {
      const projectId = ops.projectIdForSetup()
      print({ projectId }, projectId)
      return 0
    },
  },
  {
    name: "login",
    summary: "Approve this terminal in the Nuni dashboard (works over SSH too)",
    section: "Comments",
    async run({ ops, print, openBrowser, pollMs }) {
      const outcome = await ops.login({
        pollMs,
        onWaiting({ project, url, code }) {
          print(
            { status: "waiting", url, code },
            `Signing in to ${project.id} (${project.source}).

  Open  ${url}
  Code  ${code}

Check that the code matches, then approve. Waiting…`
          )
          openBrowser(url)
        },
      })
      if (outcome.status === "signed_in") {
        print(
          {
            status: outcome.status,
            project: outcome.project,
            owner: outcome.ownerName,
          },
          `Signed in as ${outcome.ownerName} to ${outcome.projectName}. Saved to ${outcome.savedTo}`
        )
        return 0
      }
      const message =
        outcome.status === "denied"
          ? "The sign-in was denied."
          : "The code expired. Run login again."
      print({ status: outcome.status, message }, undefined, [message])
      return 1
    },
  },
  {
    name: "whoami",
    summary: "Who this terminal is signed in as",
    section: "Comments",
    async run({ ops, print }) {
      const me = await ops.whoami()
      print(
        me,
        me.signedIn
          ? `Signed in to ${me.project} as ${me.owner}.`
          : `Not signed in to ${me.project}. ${LOGIN_HINT}`
      )
      return me.signedIn ? 0 : 1
    },
  },
  {
    name: "comments",
    usage: `[--status open|resolved] [--page /path] [--limit 20] [--search "words"] [--group page|element]`,
    summary: "List comments, newest first (or best match with --search)",
    section: "Comments",
    async run({ ops, flags, print }) {
      const status = oneOf(flags.status, STATUSES, "--status")
      const groupBy = oneOf(flags.group, GROUPS, "--group")
      const list = await ops.listComments({
        status,
        path: flags.page,
        search: flags.search,
        limit: positiveInteger(flags.limit, "--limit"),
      })
      const { comments, cursor } = list
      print(
        { comments, cursor },
        formatCommentList(list, {
          groupBy,
          detailHint: `Full context: ${cliCommand("comment <id>")}`,
        })
      )
      return 0
    },
  },
  {
    name: "pages",
    summary: "Pages with open comments, most first",
    section: "Comments",
    async run({ ops, print }) {
      const pages = await ops.listPages()
      print(pages, formatPageList(pages))
      return 0
    },
  },
  {
    name: "comment",
    usage: "<id> [--save-screenshot <dir>]",
    summary:
      "One comment with the element, DOM, styles, console and screenshot",
    section: "Comments",
    async run({ ops, args, flags, print }) {
      const comment = await ops.getComment(needsId(args[0], "comment <id>"))
      let screenshotFile: string | null = null
      const imageFiles: string[] = []
      if (flags.saveScreenshot) {
        const dir = resolve(flags.cwd, flags.saveScreenshot)
        for (const { kind, index, image } of await ops.images(comment)) {
          mkdirSync(dir, { recursive: true })
          const name =
            kind === "screenshot"
              ? `nuni-${comment._id}`
              : `nuni-${comment._id}-image-${index + 1}`
          const path = join(dir, `${name}.${image.mimeType.split("/")[1]}`)
          writeFileSync(path, Buffer.from(image.data, "base64"))
          if (kind === "screenshot") screenshotFile = path
          else imageFiles.push(path)
        }
      }
      print(
        { ...comment, screenshotFile, imageFiles },
        [
          buildCommentPrompt(comment),
          ...(screenshotFile
            ? [`\nScreenshot saved to ${screenshotFile}`]
            : []),
          ...imageFiles.map((path) => `Image saved to ${path}`),
        ].join("\n")
      )
      return 0
    },
  },
  {
    name: "reply",
    usage: `<id> "message"`,
    summary: "Reply in a comment's thread, as the owner",
    section: "Comments",
    async run({ ops, args: [id, body], print }) {
      if (!id || !body?.trim()) {
        throw new NuniError(
          'Pass a comment id and a message: reply <id> "message"'
        )
      }
      await ops.reply(id, body)
      print({ id, replied: true }, `Replied to ${id}.`)
      return 0
    },
  },
  statusCommand(
    "resolved",
    "Mark comments resolved, with a note saying what changed"
  ),
  statusCommand("open", "Reopen resolved comments"),
  {
    name: "logout",
    summary: "Sign this terminal out of the project",
    section: "Comments",
    async run({ ops, print }) {
      const { project, signedOut, error } = await ops.logout()
      print(
        {
          project,
          signedOut,
          ...(error
            ? { error: { code: error.code, message: error.message } }
            : {}),
        },
        signedOut
          ? `Signed out of ${project}.`
          : `Not signed in to ${project}.`,
        error
          ? [
              `Couldn't revoke the session on the server (${error.message}). Revoke it in the project settings in the dashboard.`,
            ]
          : []
      )
      return error ? 1 : 0
    },
  },
  {
    name: "mcp",
    summary: `Run the MCP server for coding agents (stdio): ${MCP_ADD_COMMAND}`,
    section: "Comments",
    async run({ ops }) {
      await serveStdio(createMcpServer(ops))
      return 0
    },
  },
]
