# Deploying Nuni

Production layout:

- `https://nuni.praveenjuge.com` → Vercel project **nuni-docs** (`apps/docs`, static Blume build)
- `https://nuni.praveenjuge.com/dashboard/*` → rewritten (see `apps/docs/vercel.json`) to Vercel project **nuni-dashboard** (`apps/dashboard`, Next.js with `basePath: /dashboard`)
- Convex production deployment (database, functions, `/widget/comments` HTTP endpoint, WorkOS webhook)
- npm: `@nuni/widget`, `@nuni/react`, `@nuni/cli`. The CDN script is served by jsDelivr from npm.

## 1. Convex

1. Create a Convex project (for example `nuni`) and link it: `cd packages/backend && npx convex dev` (log in, pick the project).
2. In the Convex dashboard, **Production** deployment → Settings → Environment variables:
   - `WORKOS_CLIENT_ID`, `WORKOS_API_KEY` (production WorkOS keys)
   - `WORKOS_WEBHOOK_SECRET` (from step 2)
   - Do **not** set `NUNI_ALLOW_TESTING` in production.
3. Generate a **production deploy key** and a **preview deploy key** (for Vercel).
4. Note the production URLs: `https://<name>.convex.cloud` and `https://<name>.convex.site`.

## 2. WorkOS

1. Create a WorkOS application (use Staging for local development, Production for the live site).
2. Authentication → enable **GitHub OAuth** (follow WorkOS's instructions to create a GitHub OAuth App with the callback URL WorkOS shows).
3. Redirects:
   - Redirect URI: `https://nuni.praveenjuge.com/dashboard/callback` (and `http://localhost:3000/dashboard/callback` in Staging)
   - Sign-in (initiate login) URI: `https://nuni.praveenjuge.com/dashboard/sign-in`
   - Sign-out redirect: `https://nuni.praveenjuge.com/dashboard`
4. Webhooks → endpoint `https://<name>.convex.site/workos/webhook`, events `user.created`, `user.updated`, `user.deleted`. Copy the secret into Convex as `WORKOS_WEBHOOK_SECRET`.

## 3. Vercel

Import the GitHub repo twice.

**nuni-dashboard** (Root Directory `apps/dashboard`; `apps/dashboard/vercel.json` sets install and build commands, the build runs `convex deploy` first)

| Variable                          | Value                                                              |
| --------------------------------- | ------------------------------------------------------------------ |
| `CONVEX_DEPLOY_KEY`               | Production deploy key (Production env) / preview key (Preview env) |
| `WORKOS_CLIENT_ID`                | WorkOS client ID                                                   |
| `WORKOS_API_KEY`                  | WorkOS API key                                                     |
| `WORKOS_COOKIE_PASSWORD`          | 32+ random characters (`openssl rand -base64 32`)                  |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | `https://nuni.praveenjuge.com/dashboard/callback`                  |
| `NEXT_PUBLIC_APP_URL`             | `https://nuni.praveenjuge.com`                                     |

`NEXT_PUBLIC_CONVEX_URL` is injected by `convex deploy`.

**nuni-docs** (Root Directory `apps/docs`; `apps/docs/vercel.json` sets the commands and the `/dashboard` rewrite)

| Variable               | Value                          |
| ---------------------- | ------------------------------ |
| `NUNI_CONVEX_URL`      | `https://<name>.convex.cloud`  |
| `NUNI_CONVEX_SITE_URL` | `https://<name>.convex.site`   |
| `NUNI_APP_URL`         | `https://nuni.praveenjuge.com` |

These are baked into the widget the docs site uses on itself.

If the dashboard's production URL is not `https://nuni-dashboard.vercel.app`, update both rewrites in `apps/docs/vercel.json`.

Optional: enable Turborepo Remote Caching (add `TURBO_TOKEN` as a GitHub secret and `TURBO_TEAM` as a GitHub variable for CI).

## 4. Domain

Add `nuni.praveenjuge.com` to **nuni-docs** and create the DNS record Vercel shows (a `CNAME nuni → cname.vercel-dns.com`).

## 5. npm packages

1. Create the npm organization `@nuni` (check it is available; otherwise pick another scope and rename the three packages).
2. Add an `NPM_TOKEN` (automation token) as a GitHub Actions secret, or configure npm Trusted Publishing for this repo.
3. Add GitHub Actions **variables** `NUNI_CONVEX_URL` and `NUNI_CONVEX_SITE_URL` (production Convex URLs). Release builds fail without them, so the published widget always points at production.
4. Add a changeset (`bun run changeset`), merge to `master`, then merge the "Version packages" PR. The release workflow publishes with provenance. jsDelivr picks it up automatically.

## 6. Smoke test

1. `npx @nuni/cli@latest init` in a fresh Next.js app, add the snippet, run it.
2. Comment on an element, reload, check the pin comes back. Open it in a second browser.
3. Claim from the panel with GitHub, allow owner tools, resolve the comment.
4. Open `https://nuni.praveenjuge.com/dashboard`, find the project, Jump to comment.
