# Nuni v1 Plan

## Context

Nuni lets anyone leave Figma-style pinned comments on a real website, with no commenter accounts, and lets the developer claim the site with GitHub and manage comments. The repo today is a bare Next.js 16.3 + shadcn (Base UI, `base-rhea`, mauve) template on bun (history: tried Vite/TanStack, reverted). The goal is to turn it into a Turborepo monorepo that ships:

- an embeddable widget (`@nuniapp/widget`, `@nuniapp/react`, CDN script),
- a CLI (`@nuniapp/cli`),
- a Convex backend,
- a Next.js dashboard with WorkOS (GitHub) auth,
- a Blume docs and landing site, all deployed on Vercel at `nuni.praveenjuge.com`.

Pin reliability is the #1 technical priority. It gets its own engine package and a CI benchmark gate.

## Decisions (from Q&A)

| Topic              | Decision                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project ID         | CLI or site generates a random public ID offline (`nuni_` + 22 base58 chars, about 128 bits). The ID is written into code. The server creates the unclaimed project on first use. |
| Visibility         | Widget is always visible everywhere, including production.                                                                                                                        |
| Claim              | First come, first served, from any origin, via GitHub sign-in.                                                                                                                    |
| Environments       | One comment space per project, matched by normalized path. Each comment stores its origin and shows an origin badge, with a "this origin only" filter.                            |
| Widget tech        | Vanilla TS in a Shadow DOM. CSS is compiled with Tailwind v4 into the shadow stylesheet.                                                                                          |
| Integrations       | React component, vanilla `init()`, and a script tag via jsDelivr. No framework auto-edit in the CLI; the agent edits files.                                                       |
| Transport          | Convex browser client, realtime over websocket. Comment creation goes through an HTTP action so we get the client IP for rate limits.                                             |
| npm                | `@nuniapp/widget`, `@nuniapp/react`, `@nuniapp/cli`. Unscoped `nuni` is an npm security holding package.                                                                          |
| Owner actions      | Resolve, reopen and delete both in the dashboard and in the widget, using a revocable widget session token.                                                                       |
| Commenters         | Post, plus edit and delete their own comments (tracked by a local secret). Only the owner resolves.                                                                               |
| Sign-in            | WorkOS with `provider: "GitHubOAuth"`, which skips the hosted AuthKit screen.                                                                                                     |
| Unclaimed projects | Kept forever. Rate limited, with a 500-comment cap until claimed.                                                                                                                 |
| Hosting            | Blume site at `nuni.praveenjuge.com` (landing + docs). The Next.js dashboard is at `/dashboard` through a Vercel rewrite (Next `basePath: "/dashboard"`).                         |
| Package manager    | Bun workspaces + Turborepo.                                                                                                                                                       |
| Prompt             | Available from: the site's "Copy prompt" button (ID baked in), `@nuniapp/cli init` output, llms.txt, and the npm README.                                                          |
| Reliability        | Playwright benchmark gate in CI (95% or better correct, near-zero wrong), plus Vitest unit tests.                                                                                 |
| Mobile             | Pins viewable on touch devices, and comments can be placed there too (tap-select, bottom-sheet composer).                                                                         |

## Monorepo layout

```
apps/
  docs/         Blume (Astro) site: landing + docs, served at nuni.praveenjuge.com
  dashboard/    Next.js 16, basePath /dashboard, WorkOS + Convex React, shadcn (moved from root)
  playground/   Vite fixture site: manual testing + reliability benchmark pages (not deployed)
packages/
  backend/      Convex: convex/ (schema, functions, http, auth.config, convex.config)
  anchor/       @nuni/anchor (internal, bundled): capture + resolve + track engine
  widget/       @nuniapp/widget: init(), Shadow DOM UI, ESM build + IIFE build for CDN
  react/        @nuniapp/react: <Nuni project="..." /> ("use client"), thin wrapper
  cli/          @nuniapp/cli: `nuni init` (bin), prints prompt + snippets
  shared/       internal: ID gen/validation, URL/path normalization, prompt text, types, limits
  tsconfig/     shared tsconfig bases (base, nextjs, library, vite)
  eslint-config/ shared flat configs
turbo.json, package.json (workspaces, packageManager bun), .changeset/, .github/workflows/
```

Build tooling: tsdown for library packages (ESM + d.ts, plus an IIFE for the widget); workspace deps are bundled into the published packages via `noExternal`. Vitest for unit tests. Playwright uses the pre-installed Chromium. Prettier stays at the root (update `tailwindStylesheet` path). `size-limit` enforces the bundle budget.

## Phase 0: Monorepo conversion

1. Root `package.json`: `workspaces: ["apps/*", "packages/*"]`, `packageManager: "bun@<current>"`, scripts delegate to `turbo run dev|build|lint|typecheck|test|bench`.
2. `turbo.json` tasks:
   - `build`: `dependsOn: ["^build"]`, outputs `dist/**`, `.next/**`, `!.next/cache/**`
   - `dev`: persistent, no cache
   - `lint`, `typecheck`, `test`
   - `bench`: depends on `build`
3. Move the existing app into `apps/dashboard`: `app/`, `components/`, `hooks/`, `lib/`, `components.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `tsconfig.json`. Keep `components/theme-provider.tsx`, `components/ui/button.tsx`, `lib/utils.ts`, `app/globals.css` as-is. Set `basePath: "/dashboard"`.
4. **Before writing any Next code, read `apps/dashboard/node_modules/next/dist/docs/`** (AGENTS.md). Known change: Next 16 uses `proxy.ts` (not `middleware.ts`), and authkit-nextjs exposes `authkitProxy()`.
5. Extract shared tsconfig and eslint packages. Move AGENTS.md guidance into `apps/dashboard/AGENTS.md` and add a root AGENTS.md describing the monorepo.
6. Root `.gitignore` additions: `.turbo`, `dist`, `.vercel`, `.astro`, `playwright-report`, `test-results`.

## Phase 1: Backend (packages/backend, Convex)

**Components** (`convex.config.ts`): `@convex-dev/workos-authkit` (user sync via WorkOS webhooks) and `@convex-dev/rate-limiter`.

**Auth** (`auth.config.ts`): WorkOS customJwt providers, following docs.convex.dev/auth/authkit (issuers `https://api.workos.com/` and `https://api.workos.com/user_management/<clientId>`, JWKS `https://api.workos.com/sso/jwks/<clientId>`).

**Schema:**

- `users`: `workosId`, `githubLogin?`, `name`, `avatarUrl?`, `email?`. Index `by_workosId`. Upserted from the component's events and on first authenticated call.
- `projects`:
  - fields: `publicId`, `ownerId?`, `name` (defaults to the first hostname), `claimedAt?`, `origins` (distinct, capped at 20), `commentCount`, `openCount`, `createdAt`, `lastActivityAt`
  - indexes: `by_publicId`, `by_owner`
- `comments`:
  - identity and content: `projectId`, `status` ("open" | "resolved"), `body` (plain text, max 2000), `authorName` (max 50), `authorKeyHash` (sha256 of the commenter's local secret)
  - location: `page` { origin, path (normalized), search, hash, title, url }, `anchor` (Anchor v1, below), `viewport` { w, h, dpr }, `userAgent`
  - timestamps: `createdAt`, `editedAt?`, `resolvedAt?`, `resolvedBy?`
  - indexes: `by_project_path_status` [projectId, page.path, status], `by_project_status_created`
- `widgetSessions`: `tokenHash`, `userId`, `projectId`, `origin`, `createdAt`, `expiresAt` (30 days). Indexes `by_tokenHash`, `by_user`.

**Public functions (widget, unauthenticated):**

- `projects.touch({ publicId, origin })`: idempotent upsert, records the origin. The client calls it once per session per origin.
- `projects.status({ publicId })` (query): claimed yes/no, owner login, counts.
- `comments.listForPage({ publicId, path })` (query, realtime): open and resolved comments. Returns `authorKeyHash` so the client can tell which comments are its own.
- `comments.listForProject({ publicId })` (query): page list with counts, for the widget's "other pages" section.
- `POST /widget/comments` (HTTP action, CORS `*`): validates, rate limits by IP + project, enforces the unclaimed cap, then calls an internal mutation. Returns the comment id.
- `comments.editOwn` and `comments.deleteOwn({ id, authorSecret })`: hash the secret and compare.

**Owner functions:**

- Dashboard calls use the WorkOS JWT via `ctx.auth`. Widget calls pass the `sessionToken` argument, which is hashed and looked up.
  - `comments.resolve`, `reopen`, `remove`, `listForOwner({ projectId, status, path?, origin? })`
- `projects.claim({ publicId })`: requires auth. Sets the owner if the project is unowned, and is a no-op if the caller already owns it. `projects.listMine`, `projects.rename`.
- `widgetSessions.create({ publicId, origin })`: owner only, returns the raw token once. `widgetSessions.listMine` and `revoke`.

**Rate limits:** 10 comments per minute per IP; 60 per minute per project; 100 `touch` calls per minute per project; 500 comments per unclaimed project.

**Tests:** `convex-test` + Vitest for the claim race, ownership checks, the cap, secret checks, and session expiry.

## Phase 2: Pin engine (packages/anchor), the #1 priority

**Anchor v1 (captured at click time):**

- `selectors`:
  - `id` (if stable)
  - `testId` (`data-testid`, `data-test`, `data-cy`, `data-nuni`)
  - `css` (shortest unique selector built from stable attributes and classes)
  - `path` (nth-of-type chain from the nearest stable ancestor)
- Element signals:
  - `tag`, `role`, `text` (normalized own and descendant text, first 120 chars), `attrs` (aria-label, name, href, src, alt, placeholder, title, type)
  - `ancestors` (up to 5: tag, stable id and classes, short text)
  - `siblingIndex` / `siblingCount`
  - `componentName?` (React fiber display name when available: extra signal now, agent context later)
- Geometry:
  - `rect` (document coords), `offset` (click point as 0..1 inside the element)
  - `viewport` { w, h, dpr, scrollX, scrollY }, `docSize`
- Stability filter: drop class names that look generated. Examples: CSS modules `_x1y2z`, `css-`/`sc-` hashes, Tailwind arbitrary or variant utilities (containing `[`, `:` or `/`), and high-entropy tokens. Drop ids that look generated (React `:r1:`, UUIDs, trailing digits). Never capture anything inside Nuni's own shadow host.

**Resolve(anchor, document) returns { element, confidence: exact | high | low | lost, score }:**

1. Candidates: hits from each selector, plus elements of the same tag whose text matches (TreeWalker), plus the element at the scaled stored point.
2. Score each candidate as a weighted sum: tag, id/testId, attribute overlap, text similarity (bigram dice), ancestor chain similarity, sibling position, geometric proximity (scaled by viewport width ratio), and size similarity.
3. Choose the best candidate above threshold. If the top two candidates are nearly tied (duplicate cards), break the tie with path and geometry. If both are still ambiguous, return `low`.
4. Below threshold, return `lost`. The comment shows in the list as "Couldn't find this element" with the stored text snippet. A wrong placement is treated as worse than `lost`.

**Tracking:**

- Pins are positioned from `getBoundingClientRect()` + offset. Updates are batched with rAF on scroll (capture, to catch scroll containers), resize, a `ResizeObserver` on anchored elements, and a debounced `MutationObserver` that re-resolves disconnected targets.
- Pins are hidden while their target is `display:none`, zero-size, or `visibility:hidden` (for example, a closed accordion).
- SPA navigation is detected by patching `pushState`/`replaceState`, plus `popstate`, `hashchange`, and the Navigation API when present.

**Path normalization** (in `shared`): strip the trailing slash and `index.html`. Ignore query and hash by default, but treat `#/route` hash routers as the path. The full URL is always stored.

**Benchmark** (`apps/playground` + Playwright):

- Each scenario has a before and an after variant. A comment is captured on "before", then "after" is loaded and resolved. Ground truth is marked with `data-bench-target`, which the engine is configured to ignore.
- Around 20 scenarios:
  - Text and ordering: text edit, sibling inserted before, list reorder, table re-sort, i18n text swap
  - Classes and ids: regenerated hashed classes, id removed
  - Structure: extra wrapper div, element moved to a new parent, duplicate identical cards, deep refactor
  - Layout: responsive 1440 to 390, font swap shift, lazy content above, sticky header, scroll container
  - Visibility and routing: collapsed accordion, SPA route away and back
  - Expected lost: element deleted, iframe content
- Metrics: correct, lost, and wrong. CI fails if correct is below 95% on non-deletion scenarios or if wrong is above 1 case.

## Phase 3: Widget (packages/widget + packages/react)

**API:**

- `init({ project, apiUrl?, getPageKey? })` returns `{ destroy }`.
- The IIFE build auto-inits from `<script ... data-project="nuni_...">`.
- `@nuniapp/react`: `<Nuni project />`, a `"use client"` component that calls `init` in an effect and `destroy` on unmount.
- The Convex URLs and app URL are baked in at publish time from CI env (`NUNI_CONVEX_URL`, `NUNI_CONVEX_SITE_URL`, `NUNI_APP_URL`). The playground overrides them with `apiUrl` to point at the dev deployment.

**Loading:** a tiny loader mounts the Shadow DOM host (max z-index, `all: initial`), then lazily imports the UI chunk and the Convex client on `requestIdleCallback`. Budget: loader under 5 KB gz, total under 60 KB gz, enforced by size-limit. The IIFE ships as a single file.

**UI (dark and light via `prefers-color-scheme`, keyboard accessible, reduced-motion aware):**

- Toolbar (bottom-right): Comment (shortcut `C`), comment list with count, and a menu (Show resolved, Claim or Owner sign-in).
- Comment mode: hovering outlines the element under the cursor, ignoring tiny or inline wrappers and preferring meaningful targets. A click drops a pin at the click point.
  - The composer is a popover: name field (first time only, saved in localStorage), textarea, `Cmd/Ctrl+Enter` to post, `Esc` to cancel.
  - Posting is optimistic, and pins appear live for other viewers.
- Pins: author initials or numbers. A click opens the comment with author, time, and an origin badge when the comment's origin differs from the current one.
  - Actions: edit and delete if the comment is mine; resolve, reopen and delete if I'm the owner.
- List panel: this page's comments (open, plus resolved when toggled), lost comments, and an "other pages" section with links.
- Deep link: `?nuni=<commentId>` opens the widget, scrolls to the pin and highlights it, then removes the param with `replaceState`.
- Touch: the Comment toggle turns on tap-to-select, and the composer opens as a bottom sheet. Pins get 44px hit targets.
- Claim and owner sign-in:
  1. The widget opens a popup at `https://nuni.praveenjuge.com/dashboard/claim?project=<id>&origin=<origin>`.
  2. In the popup, GitHub sign-in runs, then `projects.claim` if the project is unowned, then a screen asking the user to allow owner tools on `<origin>`, then `widgetSessions.create`.
  3. The popup sends the token with `postMessage` to `window.opener`, targeted at that exact origin.
  4. The widget stores the token in localStorage, keyed by project. If someone else owns the project, the popup shows "Claimed by @login".
- Local storage keys: `nuni:name`, `nuni:author-secret` (random, 128 bits), `nuni:session:<project>`. All access is wrapped in try/catch.

## Phase 4: CLI + prompt (packages/cli, packages/shared)

- `npx @nuniapp/cli init`:
  1. Detects the framework from package.json and files (Next app/pages router, Vite React, Remix/React Router, TanStack Start, Astro, SvelteKit, Vue/Nuxt, plain HTML).
  2. Generates a project ID.
  3. Prints the exact install command and snippet for that framework, plus where to place it (root layout or entry).
  - It doesn't edit files; the agent does. The `--id <existing>` flag reuses an ID, and `--json` gives machine-readable output.
- A single prompt template lives in `packages/shared/prompt.ts` and is used by the CLI, the docs island, and the READMEs (generated at build time), so they never drift apart. The prompt tells the agent to:
  - install `@nuniapp/widget` (or `@nuniapp/react`) and mount it once globally,
  - use the given ID, or run the CLI to get one,
  - leave the ID committed in the code (it's public).

## Phase 5: Dashboard (apps/dashboard)

- Stack: Next 16 app router, `basePath: "/dashboard"`, shadcn (existing setup), `@workos-inc/authkit-nextjs` (`proxy.ts` with `authkitProxy()`), and Convex React with WorkOS tokens. Use Convex's AuthKit Next.js template as the reference for wiring `ConvexProviderWithAuth`.
- GitHub-direct sign-in: a route handler that calls `workos.userManagement.getAuthorizationUrl({ provider: "GitHubOAuth", clientId, redirectUri, state })`. The callback uses authkit's `handleAuth()`. Verify that authkit's callback accepts this flow; if it doesn't, handle the code exchange in our own route.
- Routes (all under /dashboard):
  - `/` (projects list)
  - `/p/[publicId]`: Open and Resolved tabs; filters by page and origin; each row shows body, author, page, origin and time, with Jump, Resolve/Reopen and Delete. Rename and the install snippet are also here.
  - `/p/[publicId]/sessions`: signed-in widget browsers, with revoke
  - `/claim` (the popup flow)
  - `/sign-in`, `/callback`, `/sign-out`
- Jump opens `<comment origin><path>?nuni=<id>` in a new tab.
- Direct visits to `*.vercel.app` redirect to the canonical domain, so cookies and the redirect URI stay consistent.

## Phase 6: Site + docs (apps/docs, Blume)

- `npx blume init` in `apps/docs`, then `blume.config.ts` with `deployment.site = https://nuni.praveenjuge.com`. Blume generates `llms.txt` / `llms-full.txt` automatically.
- Pages:
  - Landing (hero, the core flow, Copy prompt)
  - Quickstart; Install (React, script tag, vanilla)
  - How pins work; Claiming; Dashboard
  - Privacy: comments are readable by anyone who has the site or the ID
  - CSP: allow `connect-src https://*.convex.cloud wss://*.convex.cloud https://*.convex.site` and `script-src cdn.jsdelivr.net`
  - FAQ
- Island `CopyPrompt`: generates an ID with `crypto.getRandomValues` (via `shared`), renders the prompt with the ID filled in, and copies it on click.
- Dogfood: the docs site itself runs the Nuni widget.
- `vercel.json` rewrites `/dashboard` and `/dashboard/:path*` to the dashboard's Vercel production URL. Deploy Blume as static output so `vercel.json` applies. If the rewrites misbehave, fall back to Vercel Microfrontends.

## Phase 7: Deploy + release

**Vercel:**

- Two projects from the same repo.
- `nuni-docs` (root `apps/docs`) serves the `nuni.praveenjuge.com` domain.
- `nuni-dashboard` (root `apps/dashboard`) is reached through the rewrite.
  - Build command: `cd ../../packages/backend && bunx convex deploy --cmd 'cd ../../apps/dashboard && bun run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`
  - It uses a production `CONVEX_DEPLOY_KEY`, plus a preview deploy key for per-branch Convex backends.
- Turborepo remote cache via Vercel, with `turbo-ignore` so unaffected apps skip builds.

**Environment variables:**

| Where                           | Variables                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Convex                          | `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_WEBHOOK_SECRET`                                                                                                          |
| Dashboard                       | `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://nuni.praveenjuge.com/dashboard/callback`, `CONVEX_DEPLOY_KEY` |
| Widget publish (GitHub Actions) | `NUNI_CONVEX_URL`, `NUNI_CONVEX_SITE_URL`, `NUNI_APP_URL`                                                                                                              |

**GitHub Actions:**

- `ci.yml`: bun install, then `turbo lint typecheck test build`, size-limit, and the Playwright benchmark.
- `release.yml`: Changesets opens a version PR, then publishes the 3 packages to npm with provenance (trusted publishing). jsDelivr serves `@nuniapp/widget@1` automatically.

**Your setup checklist:**

- npm: register the npm org `@nuni` (check availability first; fallback scope `@nunijs`).
- WorkOS: create the app (staging + prod), enable GitHub OAuth (GitHub OAuth app pointed at WorkOS's callback), and add the redirect URIs.
- Convex: create the project.
- DNS: add a CNAME for `nuni.praveenjuge.com` to Vercel.

## Phase 8: Launch QA

- Install via the prompt into 4 real targets: a Next.js app router app, a Vite React SPA, a static HTML page (script tag), and a site with a strict CSP.
- Run the full flow on each: add, deploy to preview and prod, comment from desktop and phone, claim, resolve in the widget and the dashboard, delete, deep link.

## Risks accepted (flagged, not blocking v1)

- **Always-visible widget on prod:** every visitor sees the widget and all pins. The docs state this clearly. An `enabled` prop can be added later.
- **First-come claim:** a visitor could claim before the developer does. The claim is logged (user, origin, time) so a manual support transfer is possible. A dashboard "release project" action comes after v1.
- **Comments are public:** anyone with the project ID can read them through the API. This goes on the Privacy page.
- **Host CSP:** host sites with a strict CSP must allow the Convex domains. This is documented.
- **Blume behind rewrites:** assets and base path need verification in Phase 6.

## Verification

1. `bun install && bun run dev`: turbo starts `convex dev`, the dashboard (localhost:3000/dashboard), docs, the playground (localhost:5173), and the widget in watch mode.
2. In the playground:
   - Enter a name, comment on 3 elements, and see the pins.
   - Reload, and the pins persist.
   - A second browser shows the pins live.
   - Edit and delete your own comment; a non-owner cannot resolve.
3. Claim from the playground popup with GitHub (WorkOS staging). The project appears in the dashboard. Resolve in the widget and see it update in the dashboard live, then the reverse. Revoke the session and confirm the widget's owner tools disappear.
4. Deep link: Jump from the dashboard focuses the correct pin.
5. `bun run bench`: the report shows correct, lost and wrong counts per scenario, with the 95% gate passing.
6. `bun run test` (Vitest + convex-test), `bun run typecheck`, `bun run lint`, and the size-limit check all pass.
7. Pack a tarball (`bun pm pack`), install it into a scratch Next.js app, and follow the copied prompt from the docs site with an agent. Commenting should work in under 2 minutes.
8. On a Vercel preview, run through steps 2 to 4 on the deployed URLs, including the `/dashboard` rewrite and the WorkOS callback.
