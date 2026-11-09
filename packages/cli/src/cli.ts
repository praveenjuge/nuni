import { resolve } from "node:path"
import { parseArgs } from "node:util"

import { CLI_NPX, cliCommand, DOCS_URL } from "@nuni/shared"

import {
  COMMANDS,
  LOGIN_HINT,
  openInBrowser,
  type Command,
  type Input,
} from "./commands"
import { VERSION } from "./env"
import { describeError, NuniError } from "./errors"
import { createOps } from "./ops"
import { createRemote, type Remote } from "./remote"

const OPTIONS = {
  id: { type: "string" },
  project: { type: "string", short: "p" },
  cwd: { type: "string" },
  status: { type: "string" },
  page: { type: "string" },
  limit: { type: "string" },
  "save-screenshot": { type: "string" },
  note: { type: "string" },
  search: { type: "string" },
  group: { type: "string" },
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", short: "v", default: false },
} as const

const DEFAULT_COMMAND = "init"

const usageOf = (command: Command) =>
  `${command.name}${command.usage ? ` ${command.usage}` : ""}`

const HELP = `nuni ${VERSION}: pinned comments on your live site

Usage: ${CLI_NPX} <command> [options]   (${DEFAULT_COMMAND} when there is none)
${[...new Set(COMMANDS.map((c) => c.section))]
  .map(
    (section) =>
      `\n${section}\n${COMMANDS.filter((c) => c.section === section)
        .map((c) => `  ${usageOf(c)}\n      ${c.summary}`)
        .join("\n")}`
  )
  .join("\n")}

The project comes from --project, $NUNI_PROJECT, or the nuni_ ID in your code.
Add --json to any command for machine-readable output.

Docs: ${DOCS_URL}`

/** The seams tests replace. */
export interface RunOptions {
  remote?: Remote
  out?: (line: string) => void
  err?: (line: string) => void
  pollMs?: number
  openBrowser?: (url: string) => void
}

function parse(argv: string[]) {
  try {
    return parseArgs({ args: argv, allowPositionals: true, options: OPTIONS })
  } catch (error) {
    throw new NuniError((error as Error).message)
  }
}

function find(name: string): Command {
  const command = COMMANDS.find((c) => c.name === name)
  if (!command) {
    throw new NuniError(
      `Unknown command "${name}". Run \`${cliCommand("help")}\` to see them all.`
    )
  }
  return command
}

export async function run(
  argv: string[],
  options: RunOptions = {}
): Promise<number> {
  const out = options.out ?? ((line: string) => console.log(line))
  const err = options.err ?? ((line: string) => console.error(line))
  // Before parsing, so that a parse error is JSON too.
  const json = argv.includes("--json")
  const print: Input["print"] = (data, text, problems = []) => {
    if (json) return out(JSON.stringify(data))
    if (text !== undefined) out(text)
    problems.forEach((problem) => err(problem))
  }
  const color = !options.out && Boolean(process.stdout.isTTY)
  const style = {
    bold: (s: string) => (color ? `\x1b[1m${s}\x1b[22m` : s),
    dim: (s: string) => (color ? `\x1b[2m${s}\x1b[22m` : s),
  }

  try {
    const { values, positionals } = parse(argv)
    const [name, ...args] = positionals
    if (values.version) {
      print({ version: VERSION }, VERSION)
      return 0
    }
    if (values.help || name === "help") {
      const topic = name === "help" ? args[0] : name
      const commands = topic ? [find(topic)] : COMMANDS
      print(
        {
          commands: commands.map((c) => ({
            name: c.name,
            usage: usageOf(c),
            summary: c.summary,
          })),
        },
        topic
          ? `Usage: ${CLI_NPX} ${usageOf(commands[0]!)}\n\n${commands[0]!.summary}`
          : HELP
      )
      return 0
    }
    const cwd = resolve(values.cwd ?? process.cwd())
    return await find(name ?? DEFAULT_COMMAND).run({
      ops: createOps({
        remote: options.remote ?? createRemote(),
        project: values.project ?? values.id,
        cwd,
      }),
      args,
      flags: {
        cwd,
        status: values.status,
        page: values.page,
        limit: values.limit,
        search: values.search,
        group: values.group,
        note: values.note,
        saveScreenshot: values["save-screenshot"],
      },
      print,
      style,
      openBrowser: options.openBrowser ?? openInBrowser,
      pollMs: options.pollMs,
    })
  } catch (error) {
    if (!(error instanceof NuniError)) throw error
    const message = describeError(error, LOGIN_HINT)
    err(
      json ? JSON.stringify({ error: { code: error.code, message } }) : message
    )
    return 1
  }
}
