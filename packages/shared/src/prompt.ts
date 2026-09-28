export const PACKAGES = {
  widget: "@nuni/widget",
  react: "@nuni/react",
  cli: "@nuni/cli",
} as const

export const CDN_URL =
  "https://cdn.jsdelivr.net/npm/@nuni/widget@0/dist/nuni.global.js"
export const DOCS_URL = "https://nuni.praveenjuge.com"

/**
 * The prompt a developer pastes into Codex, Claude Code, Cursor, etc.
 * Single source of truth for the docs site, CLI and READMEs.
 */
export function buildAgentPrompt(options: { projectId?: string } = {}): string {
  const idLine = options.projectId
    ? `Use this Nuni project ID: ${options.projectId}`
    : `Get a project ID by running: npx ${PACKAGES.cli}@latest init (it prints the ID and the exact snippet for this framework).`

  return `Add Nuni (pinned comments on the live site) to this project.

${idLine}

Steps:
1. Detect the framework and package manager.
2. If the app uses React (Next.js, Vite, Remix, React Router, TanStack Start, etc.):
   - Install ${PACKAGES.react}.
   - Render <Nuni project="PROJECT_ID" /> once, globally, in the root layout or app entry (for Next.js App Router: app/layout.tsx, inside <body>). It is already a client component.
3. Otherwise, if there is a bundler (Vue, Svelte, Astro, Angular, etc.):
   - Install ${PACKAGES.widget}.
   - Call init({ project: "PROJECT_ID" }) once on the client, in the app entry or root layout. import { init } from "${PACKAGES.widget}".
4. If there is no bundler (plain HTML, WordPress, Webflow): add this before </body> on every page:
   <script src="${CDN_URL}" data-project="PROJECT_ID" defer></script>
5. Commit the project ID directly in the code. It is public, not a secret. Do not put it in an env var.
6. Do not add Nuni to server-only code, and do not load it more than once.
7. If the site sends a Content-Security-Policy, allow connect-src https://*.convex.cloud wss://*.convex.cloud https://*.convex.site (and script-src cdn.jsdelivr.net for the script tag).
8. Start the dev server, open the site, and confirm the Nuni button appears in the bottom-right corner.

Docs: ${DOCS_URL}/quickstart`
}
