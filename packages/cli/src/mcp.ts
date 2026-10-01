import { createInterface } from "node:readline"

import { buildCommentPrompt, PACKAGES } from "@nuni/shared"

import { credentialFor } from "./credentials"
import { formatCommentList } from "./format"
import { ProjectError, resolveProject } from "./project"
import { RemoteError, type Remote } from "./remote"

/**
 * A Model Context Protocol server over stdio (newline-delimited JSON-RPC),
 * so coding agents can read and resolve comments:
 *
 *   claude mcp add nuni -- npx -y @nuniapp/cli@latest mcp
 *
 * Tools only. Small on purpose, with no dependencies: initialize, ping,
 * tools/list and tools/call.
 */

const PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
]

type Json = Record<string, unknown>

interface Request {
  jsonrpc: "2.0"
  id?: string | number | null
  method: string
  params?: Json
}

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }

interface ToolResult {
  content: Content[]
  isError?: boolean
}

interface Tool {
  name: string
  title: string
  description: string
  inputSchema: Json
  annotations?: Json
  run(args: Json): Promise<ToolResult>
}

export interface McpOptions {
  remote: Remote
  version: string
  /** --project from the command line. */
  project?: string
  cwd: string
  /** Fetch a screenshot as base64. */
  fetchImage?: (
    url: string
  ) => Promise<{ data: string; mimeType: string } | null>
}

const LOGIN = `npx ${PACKAGES.cli}@latest login`

class ToolError extends Error {}

const text = (value: string): ToolResult => ({
  content: [{ type: "text", text: value }],
})

function str(args: Json, name: string): string {
  const value = args[name]
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolError(`"${name}" is required`)
  }
  return value.trim()
}

export async function fetchImage(
  url: string
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const mimeType =
      res.headers.get("Content-Type")?.split(";")[0] ?? "image/webp"
    const data = Buffer.from(await res.arrayBuffer()).toString("base64")
    return { data, mimeType }
  } catch {
    return null
  }
}

export function createMcpServer(options: McpOptions) {
  const { remote } = options
  let project: string | null = null

  function session() {
    try {
      project ??= resolveProject(options.project, options.cwd).id
    } catch (error) {
      if (error instanceof ProjectError) throw new ToolError(error.message)
      throw error
    }
    const credential = credentialFor(project)
    if (!credential) {
      throw new ToolError(
        `Not signed in to the Nuni project ${project}. Ask the user to run \`${LOGIN}\` in this project (it opens the Nuni dashboard to approve), then try again.`
      )
    }
    return { publicId: project, token: credential.token }
  }

  const tools: Tool[] = [
    {
      name: "list_comments",
      title: "List Nuni comments",
      description:
        "List feedback comments left on the live site with Nuni, newest first. Each has an id, the page, the author and the element it is pinned to. Use get_comment for the full context.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["open", "resolved"],
            description: "Defaults to open.",
          },
          page: {
            type: "string",
            description: "Only comments on this path, for example /pricing.",
          },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async run(args) {
        const { publicId, token } = session()
        const status = args.status === "resolved" ? "resolved" : "open"
        const page = await remote.listComments(publicId, token, {
          status,
          path: typeof args.page === "string" ? args.page : undefined,
          limit: typeof args.limit === "number" ? args.limit : 20,
        })
        return text(
          formatCommentList(page.comments, {
            status,
            more: Boolean(page.cursor),
            detailHint:
              "Call get_comment with an id for the element, DOM, styles, console errors, failed requests and screenshot.",
          })
        )
      },
    },
    {
      name: "get_comment",
      title: "Get a Nuni comment",
      description:
        "One comment with everything needed to fix it: the comment, the page link, the element (text, selectors, React component), its HTML and styles, console errors, failed requests and a screenshot.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "The comment id." } },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async run(args) {
        const { publicId, token } = session()
        const comment = await remote.getComment(
          publicId,
          token,
          str(args, "id")
        )
        if (!comment)
          throw new ToolError("No comment with that id in this project")
        const content: Content[] = [
          { type: "text", text: buildCommentPrompt(comment) },
        ]
        if (comment.screenshotUrl) {
          const image = await (options.fetchImage ?? fetchImage)(
            comment.screenshotUrl
          )
          if (image) content.push({ type: "image", ...image })
        }
        return { content }
      },
    },
    {
      name: "resolve_comment",
      title: "Resolve a Nuni comment",
      description:
        "Mark a comment as resolved once the change it asks for is made. Visitors see it as resolved on the site.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { idempotentHint: true },
      async run(args) {
        const { token } = session()
        const id = str(args, "id")
        await remote.setStatus(token, id, "resolved")
        return text(`Resolved ${id}.`)
      },
    },
    {
      name: "reopen_comment",
      title: "Reopen a Nuni comment",
      description: "Reopen a resolved comment.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { idempotentHint: true },
      async run(args) {
        const { token } = session()
        const id = str(args, "id")
        await remote.setStatus(token, id, "open")
        return text(`Reopened ${id}.`)
      },
    },
  ]

  async function callTool(params: Json): Promise<ToolResult> {
    const tool = tools.find((t) => t.name === params.name)
    if (!tool)
      throw new RpcError(-32602, `Unknown tool: ${String(params.name)}`)
    try {
      return await tool.run((params.arguments as Json | undefined) ?? {})
    } catch (error) {
      if (error instanceof ToolError || error instanceof RemoteError) {
        const message =
          error instanceof RemoteError && error.code === "unauthenticated"
            ? `${error.message}. Ask the user to run \`${LOGIN}\` in this project, then try again.`
            : error.message
        return { content: [{ type: "text", text: message }], isError: true }
      }
      throw error
    }
  }

  /** Handle one message. Notifications get no response (null). */
  async function handle(message: Request): Promise<Json | null> {
    const id = message.id ?? null
    const isNotification = message.id === undefined
    try {
      let result: unknown
      switch (message.method) {
        case "initialize": {
          const requested = String(message.params?.protocolVersion ?? "")
          result = {
            protocolVersion: PROTOCOL_VERSIONS.includes(requested)
              ? requested
              : PROTOCOL_VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: {
              name: "nuni",
              title: "Nuni",
              version: options.version,
            },
            instructions:
              "Nuni comments are feedback pinned to elements on the live site. List them, read one with its full context, fix the code, then resolve it.",
          }
          break
        }
        case "ping":
          result = {}
          break
        case "tools/list":
          result = {
            tools: tools.map(({ run: _run, ...tool }) => tool),
          }
          break
        case "tools/call":
          result = await callTool(message.params ?? {})
          break
        default:
          if (isNotification) return null
          throw new RpcError(-32601, `Method not found: ${message.method}`)
      }
      return isNotification ? null : { jsonrpc: "2.0", id, result }
    } catch (error) {
      if (isNotification) return null
      const rpc =
        error instanceof RpcError
          ? error
          : new RpcError(
              -32603,
              error instanceof Error ? error.message : String(error)
            )
      return {
        jsonrpc: "2.0",
        id,
        error: { code: rpc.code, message: rpc.message },
      }
    }
  }

  return { handle, tools }
}

class RpcError extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message)
  }
}

/** Serve on stdin/stdout until stdin closes. Logs go to stderr only. */
export async function serveStdio(server: ReturnType<typeof createMcpServer>) {
  const write = (message: Json) => {
    process.stdout.write(`${JSON.stringify(message)}\n`)
  }
  const pending = new Set<Promise<void>>()
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      write({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      })
      continue
    }
    for (const request of Array.isArray(message) ? message : [message]) {
      // Requests run concurrently, so a slow tool call never blocks a ping.
      const task = server.handle(request as Request).then((response) => {
        if (response) write(response)
      })
      pending.add(task)
      void task.finally(() => pending.delete(task))
    }
  }
  await Promise.all(pending)
}
