# @nuni/widget

Pin a comment to anything on your site. Talk it through with your team. Give your agent the context.

Nuni adds Figma-style comments to your real, running website: localhost, preview URLs, staging or production. Anyone who can open the site can leave a comment. No commenter accounts, no API keys, no dashboard setup.

## Install

The fastest way is to paste this prompt into Codex, Claude Code, Cursor or any coding agent:

<!-- prompt:start -->

```text
Add Nuni (pinned comments on the live site) to this project.

Get a project ID by running: npx @nuni/cli@latest init (it prints the ID and the exact snippet for this framework).

Steps:
1. Detect the framework and package manager.
2. If the app uses React (Next.js, Vite, Remix, React Router, TanStack Start, etc.):
   - Install @nuni/react.
   - Render <Nuni project="PROJECT_ID" /> once, globally, in the root layout or app entry (for Next.js App Router: app/layout.tsx, inside <body>). It is already a client component.
3. Otherwise, if there is a bundler (Vue, Svelte, Astro, Angular, etc.):
   - Install @nuni/widget.
   - Call init({ project: "PROJECT_ID" }) once on the client, in the app entry or root layout. import { init } from "@nuni/widget".
4. If there is no bundler (plain HTML, WordPress, Webflow): add this before </body> on every page:
   <script src="https://cdn.jsdelivr.net/npm/@nuni/widget@0/dist/nuni.global.js" data-project="PROJECT_ID" defer></script>
5. Commit the project ID directly in the code. It is public, not a secret. Do not put it in an env var.
6. Do not add Nuni to server-only code, and do not load it more than once.
7. If the site sends a Content-Security-Policy, allow connect-src https://*.convex.cloud wss://*.convex.cloud https://*.convex.site (and script-src cdn.jsdelivr.net for the script tag).
8. Start the dev server, open the site, and confirm the Nuni button appears in the bottom-right corner.

Docs: https://nuni.praveenjuge.com/quickstart
```

<!-- prompt:end -->

Or do it yourself:

```sh
npx @nuni/cli init   # prints your project ID and the snippet for your framework
npm install @nuni/widget
```

```ts
import { init } from "@nuni/widget"

init({ project: "nuni_..." })
```

Using React? Use [`@nuni/react`](https://www.npmjs.com/package/@nuni/react). No bundler? Use the script tag:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@nuni/widget@0/dist/nuni.global.js"
  data-project="nuni_..."
  defer
></script>
```

## Options

| Option                                 | Description                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `project`                              | Your public project ID. Commit it; it is not a secret.                                     |
| `getPageKey(url)`                      | Optional. Decide which URLs share comments. Defaults to the path, ignoring query and hash. |
| `convexUrl`, `convexSiteUrl`, `appUrl` | Optional. For self-hosting or local development.                                           |

`init` returns `{ destroy() }`.

## Using it

- Press **C** (or the Comment button), click any element and write your comment.
- Pins follow their element through layout changes, responsive breakpoints and content edits. If an element is removed, its comment is listed as "Couldn't find on this page" instead of pinned to the wrong thing.
- Your name is remembered in this browser. You can edit and delete your own comments.
- The site owner claims the project from the widget ("Claim Nuni", GitHub sign-in) and can then resolve, reopen and delete comments.

## Privacy

Comments are visible to everyone who can open the site, and to anyone who knows the project ID. Don't put secrets in comments.

## Content Security Policy

If your site sends a CSP, allow `connect-src https://*.convex.cloud wss://*.convex.cloud https://*.convex.site` (and `script-src cdn.jsdelivr.net` for the script tag).

Docs: https://nuni.praveenjuge.com
