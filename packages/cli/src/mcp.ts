import { createInterface } from "node:readline"

import { buildCommentPrompt, PACKAGES } from "@nuni/shared"

import { credentialFor } from "./credentials"
import { formatCommentList, formatPageList } from "./format"
import { ProjectError, resolveProject } from "./project"
import { RemoteError, type Remote } from "./remote"
import { formatResolveResult, resolveComments } from "./resolve"

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
const MAX_RESOLVE = 50

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

  const DETAIL_HINT =
    "Call get_comment with an id for the element, DOM, styles, console errors, failed requests and screenshot."

  const listSchema = {
    status: {
      type: "string",
      enum: ["open", "resolved"],
      description: "Defaults to open.",
    },
    page: {
      type: "string",
      description: "Only comments on this path, for example /pricing.",
    },
    group_by: {
      type: "string",
      enum: ["page", "element"],
      description:
        "Put related comments together: by page, or by the element they are on (several comments about the same button, heading or text).",
    },
    limit: { type: "integer", minimum: 1, maximum: 50 },
  }

  async function list(args: Json, search?: string): Promise<ToolResult> {
    const { publicId, token } = session()
    const status = args.status === "resolved" ? "resolved" : "open"
    const page = await remote.listComments(publicId, token, {
      status,
      path: typeof args.page === "string" ? args.page : undefined,
      search,
      limit: typeof args.limit === "number" ? args.limit : 20,
    })
    return text(
      formatCommentList(page.comments, {
        status,
        more: Boolean(page.cursor),
        order: search ? "best match first" : undefined,
        groupBy:
          args.group_by === "page" || args.group_by === "element"
            ? args.group_by
            : undefined,
        detailHint: DETAIL_HINT,
      })
    )
  }

  const tools: Tool[] = [
    {
      name: "list_comments",
      title: "List Nuni comments",
      description:
        "List feedback comments left on the live site with Nuni, newest first. Each has an id, the page, the author and the element it is pinned to. Group them by page or element to fix related ones together. Use get_comment for the full context.",
      inputSchema: {
        type: "object",
        properties: listSchema,
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      run: (args) => list(args),
    },
    {
      name: "search_comments",
      title: "Search Nuni comments",
      description:
        'Find comments by the words in them or the author\'s name, best match first. For example "typo", "button color" or a person\'s name.',
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The words to look for." },
          ...listSchema,
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      run: (args) => list(args, str(args, "query")),
    },
    {
      name: "list_pages",
      title: "List pages with Nuni comments",
      description:
        "The site's pages that have open comments, with how many each has, most first. Use a path with list_comments to work through one page.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async run() {
        const { publicId, token } = session()
        return text(formatPageList(await remote.listPages(publicId, token)))
      },
    },
    {
      name: "get_comment",
      title: "Get a Nuni comment",
      description:
        "One comment with everything needed to fix it: the comment, the page link, the element (text, selectors, React component), its HTML and styles, console errors, failed requests, the images the commenter attached and a screenshot.",
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
        // The commenter's own images first, then the element's screenshot.
        for (const url of [
          ...(comment.imageUrls ?? []),
          ...(comment.screenshotUrl ? [comment.screenshotUrl] : []),
        ]) {
          const image = await (options.fetchImage ?? fetchImage)(url)
          if (image) content.push({ type: "image", ...image })
        }
        return { content }
      },
    },
    {
      name: "reply_to_comment",
      title: "Reply to a Nuni comment",
      description:
        "Reply in a comment's thread as the project owner, for example to ask a question or say what changed. Everyone on the site can read replies.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The comment id." },
          body: { type: "string", description: "The reply." },
        },
        required: ["id", "body"],
        additionalProperties: false,
      },
      async run(args) {
        const { publicId, token } = session()
        const id = str(args, "id")
        await remote.reply(publicId, token, id, str(args, "body"))
        return text(`Replied to ${id}.`)
      },
    },
    {
      name: "resolve_comment",
      title: "Resolve a Nuni comment",
      description:
        "Mark a comment as resolved once the change it asks for is made. Visitors see it as resolved on the site. Add a note to say what changed; it is posted as a reply.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          note: {
            type: "string",
            description: "Optional: what was changed, posted as a reply first.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { idempotentHint: true },
      async run(args) {
        const { publicId, token } = session()
        const id = str(args, "id")
        // Resolve first, so a note is never left on a comment that stayed open.
        await remote.setStatus(token, id, "resolved")
        if (typeof args.note === "string" && args.note.trim()) {
          await remote.reply(publicId, token, id, args.note.trim())
        }
        return text(`Resolved ${id}.`)
      },
    },
    {
      name: "resolve_comments",
      title: "Resolve several Nuni comments",
      description:
        "Resolve several comments at once, for example all the ones a single change fixed. The note, if any, is posted as a reply on each. Comments that can't be resolved are listed; the rest still are.",
      inputSchema: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: MAX_RESOLVE,
          },
          note: {
            type: "string",
            description:
              "Optional: what was changed, posted as a reply on each.",
          },
        },
        required: ["ids"],
        additionalProperties: false,
      },
      annotations: { idempotentHint: true },
      async run(args) {
        const ids = Array.isArray(args.ids)
          ? args.ids.filter((id): id is string => typeof id === "string")
          : []
        if (!ids.length) throw new ToolError(`"ids" is required`)
        if (ids.length > MAX_RESOLVE) {
          throw new ToolError(`Resolve up to ${MAX_RESOLVE} comments at a time`)
        }
        const result = await resolveComments(
          remote,
          session(),
          ids,
          typeof args.note === "string" ? args.note : undefined
        )
        return {
          ...text(formatResolveResult(result)),
          ...(result.resolved.length ? {} : { isError: true }),
        }
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
              "Nuni comments are feedback pinned to elements on the live site. List them (by page or grouped by element), search them, read one with its full context, fix the code, then resolve it. Resolve several at once when one change fixed them all.",
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
