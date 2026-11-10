export const PACKAGES = {
  widget: "@nuniapp/widget",
  react: "@nuniapp/react",
  cli: "@nuniapp/cli",
} as const

export const CDN_URL =
  "https://cdn.jsdelivr.net/npm/@nuniapp/widget@latest/dist/nuni.global.js"
export const DOCS_URL = "https://nuni.praveenjuge.com"

/** How people (and agents) are told to run the CLI. */
export const CLI_NPX = `npx ${PACKAGES.cli}@latest`

export function cliCommand(command: string): string {
  return `${CLI_NPX} ${command}`
}

/** The MCP server `nuni mcp` runs, and how to add it to Claude Code. */
export const MCP_SERVER_NAME = "nuni"
export const MCP_ADD_COMMAND = `claude mcp add ${MCP_SERVER_NAME} -- npx -y ${PACKAGES.cli}@latest mcp`

/** MCP tools that prompts tell agents to call. */
export const MCP_TOOLS = { resolveComment: "resolve_comment" } as const

/**
 * The prompt a developer pastes into Codex, Claude Code, Cursor, etc.
 * Single source of truth for the docs site, CLI and READMEs.
 */
export function buildAgentPrompt(options: { projectId?: string } = {}): string {
  const idLine = options.projectId
    ? `Use this Nuni project ID: ${options.projectId}`
    : `Get a project ID by running: ${cliCommand("init")} (it prints the ID and the exact snippet for this framework).`

  return `Add Nuni (pinned comments on the live site) to this project.

${idLine}

Steps:
1. Detect the framework and package manager.
2. If the app uses React (Next.js, Vite, Remix, React Router, TanStack Start, etc.):
   - Install ${PACKAGES.react}@latest.
   - Render <Nuni project="PROJECT_ID" /> once, globally, in the root layout or app entry (for Next.js App Router: app/layout.tsx, inside <body>). It is already a client component.
3. Otherwise, if there is a bundler (Vue, Svelte, Astro, Angular, etc.):
   - Install ${PACKAGES.widget}@latest.
   - Call init({ project: "PROJECT_ID" }) once on the client, in the app entry or root layout. import { init } from "${PACKAGES.widget}".
4. If there is no bundler (plain HTML, WordPress, Webflow): add this before </body> on every page:
   <script src="${CDN_URL}" data-project="PROJECT_ID" defer></script>
5. Commit the project ID directly in the code. It is public, not a secret. Do not put it in an env var.
6. Do not add Nuni to server-only code, and do not load it more than once.
7. If the site sends a Content-Security-Policy, allow connect-src https://*.convex.cloud wss://*.convex.cloud https://*.convex.site (and script-src cdn.jsdelivr.net for the script tag).
8. Start the dev server, open the site, and confirm the Nuni button appears in the bottom-right corner.
9. Tell the user they can let you read and resolve comments later: run ${cliCommand("login")} once, then add the MCP server (for Claude Code: ${MCP_ADD_COMMAND}). Do not run login yourself unless asked.

Docs: ${DOCS_URL}/quickstart`
}
