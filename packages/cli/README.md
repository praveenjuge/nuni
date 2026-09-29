# @nuniapp/cli

Sets up [Nuni](https://nuni.praveenjuge.com) in any project.

```sh
npx @nuniapp/cli init           # new project ID + install steps for your framework
npx @nuniapp/cli init --json    # the same, machine-readable (for agents)
npx @nuniapp/cli prompt         # the ready-made prompt for your coding agent
npx @nuniapp/cli id             # just a new project ID
```

`init` does not edit your files. It detects your framework (Next.js, React, Vue, Nuxt, SvelteKit, Astro, Angular, plain HTML and more) and package manager, and prints exactly what to add and where.

## Agent prompt

<!-- prompt:start -->

```text
Add Nuni (pinned comments on the live site) to this project.

Get a project ID by running: npx @nuniapp/cli@latest init (it prints the ID and the exact snippet for this framework).

Steps:
1. Detect the framework and package manager.
2. If the app uses React (Next.js, Vite, Remix, React Router, TanStack Start, etc.):
   - Install @nuniapp/react.
   - Render <Nuni project="PROJECT_ID" /> once, globally, in the root layout or app entry (for Next.js App Router: app/layout.tsx, inside <body>). It is already a client component.
3. Otherwise, if there is a bundler (Vue, Svelte, Astro, Angular, etc.):
   - Install @nuniapp/widget.
   - Call init({ project: "PROJECT_ID" }) once on the client, in the app entry or root layout. import { init } from "@nuniapp/widget".
4. If there is no bundler (plain HTML, WordPress, Webflow): add this before </body> on every page:
   <script src="https://cdn.jsdelivr.net/npm/@nuniapp/widget@0/dist/nuni.global.js" data-project="PROJECT_ID" defer></script>
5. Commit the project ID directly in the code. It is public, not a secret. Do not put it in an env var.
6. Do not add Nuni to server-only code, and do not load it more than once.
7. If the site sends a Content-Security-Policy, allow connect-src https://*.convex.cloud wss://*.convex.cloud https://*.convex.site (and script-src cdn.jsdelivr.net for the script tag).
8. Start the dev server, open the site, and confirm the Nuni button appears in the bottom-right corner.

Docs: https://nuni.praveenjuge.com/quickstart
```

<!-- prompt:end -->
