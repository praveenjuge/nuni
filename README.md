# Nuni

Pin a comment to anything on your site. Talk it through with your team. Give your agent the context.

**Add → Deploy → Comment → Claim → Resolve.** A developer adds Nuni to an existing site in a couple of minutes (with no account and no secret keys), and anyone who can open the site can leave Figma-style comments on the real product.

Site and docs: https://nuni.praveenjuge.com · Dashboard: https://nuni.praveenjuge.com/dashboard

## Repository

Turborepo + Bun workspaces.

| Path                                          | What                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/docs`                                   | Landing page and docs (Blume). Served at `/`. Rewrites `/dashboard` to the dashboard.    |
| `apps/dashboard`                              | Owner dashboard (Next.js 16, `basePath: /dashboard`, WorkOS GitHub sign-in, Convex).     |
| `apps/playground`                             | Vite + React test site and the Playwright end-to-end tests. Not deployed.                |
| `packages/backend`                            | Convex: schema, widget and owner functions, HTTP comment endpoint, WorkOS, rate limits.  |
| `packages/anchor`                             | The pin engine: capture, resolve and the reliability benchmark. Bundled into the widget. |
| `packages/widget`                             | `@nuniapp/widget`: the embeddable widget (Shadow DOM, vanilla TS). ESM + CDN script.     |
| `packages/react`                              | `@nuniapp/react`: `<Nuni project="..." />`.                                              |
| `packages/cli`                                | `@nuniapp/cli`: `npx @nuniapp/cli init` prints a project ID and install steps.           |
| `packages/shared`                             | IDs, path normalization, limits, types and the agent prompt (single source of truth).    |
| `packages/tsconfig`, `packages/eslint-config` | Shared configs.                                                                          |

## Develop

Requirements: Bun 1.4.2, Node 22.12+. Run `bun --version` to verify the installed Bun version before installing dependencies.

```bash
bun install

# 1. Start a local Convex backend (no account needed). Keep it running.
cd packages/backend
CONVEX_AGENT_MODE=anonymous npx convex dev
# first time only, in another terminal:
npx convex env set WORKOS_CLIENT_ID client_placeholder
npx convex env set WORKOS_API_KEY placeholder-api-key
npx convex env set WORKOS_WEBHOOK_SECRET placeholder
npx convex env set NUNI_ALLOW_TESTING 1   # enables the e2e seeding helper locally

# 2. In another terminal, from the repo root
cp apps/dashboard/.env.example apps/dashboard/.env.local   # add real WorkOS keys to test sign-in
bunx turbo run dev --filter=@nuni/playground --filter=@nuni/dashboard --filter=@nuniapp/widget --filter=@nuni/docs
```

- Playground: http://127.0.0.1:5173 (press **C** and click anything)
- Dashboard: http://localhost:3000/dashboard
- Docs: http://localhost:4321

## Checks

```bash
bunx turbo run build lint typecheck test   # everything
bun run bench                              # pin reliability benchmark (Playwright)
bun run e2e                                # widget end-to-end tests (needs the local backend)
bun run format:check && bun run readmes:check
```

Playwright uses its own Chromium. To use a preinstalled one: `CHROMIUM_PATH=/path/to/chrome bun run bench`.

## Deploy and release

See [DEPLOYING.md](./DEPLOYING.md) for the full dev (WorkOS staging, GitHub sign-in) and production checklist. To release the public packages, increase the root `package.json` version and merge to `master`.
