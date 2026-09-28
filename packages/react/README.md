# @nuni/react

React component for [Nuni](https://nuni.praveenjuge.com): pinned comments on your live site.

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

## Usage

```sh
npx @nuni/cli init   # prints your project ID
npm install @nuni/react
```

Render it once, in your root layout. It is a client component, so it works from Next.js Server Components too.

```tsx
// app/layout.tsx
import { Nuni } from "@nuni/react"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Nuni project="nuni_..." />
      </body>
    </html>
  )
}
```

Props are the same as `init()` in [`@nuni/widget`](https://www.npmjs.com/package/@nuni/widget).
