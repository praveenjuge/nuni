# Setting up Nuni (dev and prod)

Everything you need to configure outside this repo, in order. Sources: Convex docs (AuthKit, Vercel hosting, preview deployments, environment variables) and WorkOS docs (AuthKit Next.js, GitHub OAuth, redirect URIs, webhooks, launch checklist).

## How the pieces connect

| Piece               | Dev                                              | Prod                                                                            |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Docs + landing      | `http://localhost:4321`                          | `https://nuni.praveenjuge.com` (Vercel **nuni-docs**)                           |
| Dashboard           | `http://localhost:3000/dashboard`                | `https://nuni.praveenjuge.com/dashboard` (rewrite to Vercel **nuni-dashboard**) |
| Convex              | your dev deployment (or a local anonymous one)   | production deployment                                                           |
| WorkOS              | **Staging** environment                          | **Production** environment                                                      |
| GitHub sign-in      | WorkOS default GitHub credentials (staging only) | your own GitHub OAuth App                                                       |
| Widget on npm / CDN | built with local defaults                        | built by the release workflow with prod Convex URLs                             |

Sign-in skips the AuthKit screen: the dashboard uses the AuthKit PKCE flow with `provider=GitHubOAuth`, which is the documented way to go straight to GitHub.

---

## Part 1: Development

### Option A: widget only, no accounts (fastest)

Good for working on the widget, pins and backend. No sign-in.

```bash
bun install
cd packages/backend
CONVEX_AGENT_MODE=anonymous npx convex dev --once || true   # creates a local backend; first push fails until env is set
npx convex env set WORKOS_CLIENT_ID client_placeholder
npx convex env set WORKOS_API_KEY sk_test_placeholder
npx convex env set WORKOS_WEBHOOK_SECRET placeholder
npx convex env set NUNI_ALLOW_TESTING 1
CONVEX_AGENT_MODE=anonymous npx convex dev                  # keep running
```

Then `bunx turbo run dev --filter=@nuni/playground --filter=@nuni/widget` and open http://127.0.0.1:5173. The widget and playground default to the local backend (`127.0.0.1:3210` / `:3211`).

### Option B: full stack with GitHub sign-in

#### 1. Convex dev deployment

- [ ] Create a Convex account and project, then link the backend: `cd packages/backend && npx convex dev`. When it asks about WorkOS, choose **No** (you are using your own WorkOS team, "Option 2" in the Convex docs). The CLI writes `packages/backend/.env.local` with `CONVEX_DEPLOYMENT` and `CONVEX_URL`.
- [ ] Note your dev URLs: `https://<dev-name>.convex.cloud` and `https://<dev-name>.convex.site`.

#### 2. WorkOS staging environment

In https://dashboard.workos.com with the **Staging** environment selected:

- [ ] **API keys**: copy the Client ID (`client_01...`) and API key (`sk_test_...`).
- [ ] **Authentication → OAuth providers → GitHub → Manage → Enable**. In staging you can use the WorkOS default credentials, so no GitHub app is needed yet.
- [ ] **Applications → your app → Redirects**:
  - Redirect URI: `http://localhost:3000/dashboard/callback` (set it as the **default**; wildcards cannot be the default).
  - Sign-in endpoint / Initiate login URI: `http://localhost:3000/dashboard/sign-in`
  - Sign-out redirect / App homepage URL: `http://localhost:3000/dashboard`
- [ ] Optional (only with a cloud dev deployment, since webhooks need a public HTTPS URL): **Webhooks → Create endpoint** `https://<dev-name>.convex.site/workos/webhook`, events `user.created`, `user.updated`, `user.deleted`. Copy the signing secret. Without the webhook, users are still stored on first sign-in by the dashboard.

#### 3. Convex dev environment variables

```bash
cd packages/backend
npx convex env set WORKOS_CLIENT_ID client_01...        # staging
npx convex env set WORKOS_API_KEY sk_test_...
npx convex env set WORKOS_WEBHOOK_SECRET <secret or any placeholder>
npx convex env set NUNI_ALLOW_TESTING 1                 # optional: e2e seeding helper, never in prod
```

All three `WORKOS_*` variables must exist before a push succeeds (the AuthKit component checks them at load). `auth.config.ts` reads `WORKOS_CLIENT_ID` to trust WorkOS access tokens.

#### 4. Local env files

`apps/dashboard/.env.local` (copy from `.env.example`):

```bash
WORKOS_CLIENT_ID=client_01...            # staging
WORKOS_API_KEY=sk_test_...
WORKOS_COOKIE_PASSWORD=$(openssl rand -base64 32)   # paste the value, 32+ chars
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/dashboard/callback
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_CONVEX_URL=https://<dev-name>.convex.cloud
```

`apps/playground/.env.local`:

```bash
VITE_CONVEX_URL=https://<dev-name>.convex.cloud
VITE_CONVEX_SITE_URL=https://<dev-name>.convex.site
VITE_APP_URL=http://localhost:3000
```

For the docs site to dogfood the widget against your dev deployment, export `NUNI_CONVEX_URL`, `NUNI_CONVEX_SITE_URL` and `NUNI_APP_URL` before building the widget.

#### 5. Run

```bash
cd packages/backend && npx convex dev          # terminal 1, keep running
bunx turbo run dev --filter=@nuni/dashboard --filter=@nuni/playground --filter=@nuni/widget   # terminal 2
```

Check: open the playground, leave a comment, open the Nuni panel → **Claim Nuni** → GitHub → **Allow**. The panel shows **Owner**. http://localhost:3000/dashboard lists the project.

---

## Part 2: Production

### 1. GitHub OAuth App (for WorkOS production)

WorkOS default GitHub credentials only work in staging.

- [ ] In WorkOS **Production** → Authentication → OAuth providers → GitHub → Manage, copy the **Redirect URI** WorkOS shows.
- [ ] GitHub → Settings → Developer settings → **OAuth Apps → New OAuth App** (or under a GitHub org). Name "Nuni", homepage `https://nuni.praveenjuge.com`, **Authorization callback URL** = the WorkOS Redirect URI. Keep the `user:email` scope (WorkOS needs the email).
- [ ] Generate a client secret. Paste the GitHub Client ID and Secret into WorkOS ("Your app's credentials"), enable GitHub, save.

### 2. WorkOS production environment

- [ ] Unlock Production by adding billing details (OAuth sign-ins are free; only enterprise SSO connections are billed).
- [ ] Copy the production Client ID and API key (`sk_live_...`).
- [ ] **Redirects**: default Redirect URI `https://nuni.praveenjuge.com/dashboard/callback` (production requires HTTPS, no localhost). Sign-in endpoint `https://nuni.praveenjuge.com/dashboard/sign-in`. Sign-out redirect / App homepage `https://nuni.praveenjuge.com/dashboard`.
- [ ] **Webhooks**: endpoint `https://<prod-name>.convex.site/workos/webhook`, events `user.created`, `user.updated`, `user.deleted`. Copy the signing secret.
- [ ] If sign-in works but Convex says unauthenticated, check the JWT has the right audience (Convex AuthKit troubleshooting, "missing `aud` claim"): the default session JWT is accepted by the second provider in `auth.config.ts`, so leave the JWT template at its default.

### 3. Convex production deployment

- [ ] Convex dashboard → your project → **Production** deployment → Settings → Environment variables: `WORKOS_CLIENT_ID` (prod), `WORKOS_API_KEY` (`sk_live_...`), `WORKOS_WEBHOOK_SECRET`. Do **not** set `NUNI_ALLOW_TESTING`.
- [ ] Production deployment → Settings → **Generate Production Deploy Key** with the `deployment:deploy` permission.
- [ ] Project Settings → **Generate Preview Deploy Key**.
- [ ] Project Settings → **Environment variable defaults for preview deployments**: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY` (staging values) and `WORKOS_WEBHOOK_SECRET` (any value). Every Vercel preview gets a fresh Convex backend, and pushes fail without these.
- [ ] Note the production URLs `https://<prod-name>.convex.cloud` and `https://<prod-name>.convex.site`.

### 4. Vercel: nuni-dashboard

- [ ] New project from the GitHub repo, **Root Directory** `apps/dashboard` (keep "Include files outside the root directory" on). `apps/dashboard/vercel.json` sets the install command and the build command, which runs `convex deploy` first (it injects `NEXT_PUBLIC_CONVEX_URL`).
- [ ] Environment variables:

| Variable                          | Production                                        | Preview                      |
| --------------------------------- | ------------------------------------------------- | ---------------------------- |
| `CONVEX_DEPLOY_KEY`               | production deploy key                             | preview deploy key           |
| `WORKOS_CLIENT_ID`                | prod client ID                                    | staging client ID            |
| `WORKOS_API_KEY`                  | `sk_live_...`                                     | `sk_test_...`                |
| `WORKOS_COOKIE_PASSWORD`          | 32+ random chars                                  | 32+ random chars (different) |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | `https://nuni.praveenjuge.com/dashboard/callback` | leave unset                  |
| `NEXT_PUBLIC_APP_URL`             | `https://nuni.praveenjuge.com`                    | leave unset                  |

Previews fall back to their own branch URL (`VERCEL_BRANCH_URL`). WorkOS does not allow wildcards on `*.vercel.app` (it is a public suffix), so `packages/backend/convex.json` registers each preview's `https://<branch-url>/dashboard/callback` in the staging environment during the build, using `WORKOS_API_KEY`. The same file registers the production redirect URI on production builds.

- [ ] After the first deploy, note the production URL (for example `https://nuni-dashboard.vercel.app`). If it differs, update both rewrites in `apps/docs/vercel.json`.
- [ ] Make sure Vercel Deployment Protection does not cover the production deployment (the docs site rewrites to it).

### 5. Vercel: nuni-docs

- [ ] New project from the same repo, **Root Directory** `apps/docs`. `apps/docs/vercel.json` sets the commands, output (`dist`) and the `/dashboard` rewrites.
- [ ] Environment variables (Production and Preview): `NUNI_CONVEX_URL=https://<prod-name>.convex.cloud`, `NUNI_CONVEX_SITE_URL=https://<prod-name>.convex.site`, `NUNI_APP_URL=https://nuni.praveenjuge.com`. These are baked into the widget the site runs on itself.
- [ ] **Domains**: add `nuni.praveenjuge.com`, then create the DNS record Vercel shows at your DNS provider (normally `CNAME nuni → cname.vercel-dns.com`).

### 6. npm and releases

- [ ] Create the npm organization `@nuni` (if taken, pick another scope and rename `@nuni/widget`, `@nuni/react`, `@nuni/cli`).
- [ ] GitHub repo → Settings → Secrets and variables → Actions:
  - Secret `NPM_TOKEN` (npm automation/granular token with publish rights to `@nuni`). The first publish needs a token; you can switch to npm Trusted Publishing afterwards.
  - Variables `NUNI_CONVEX_URL` and `NUNI_CONVEX_SITE_URL` (production). The release job is skipped until `NUNI_CONVEX_URL` exists, and release builds refuse to run without both.
  - Optional: secret `TURBO_TOKEN`, variable `TURBO_TEAM` for Turborepo remote caching.
- [ ] Release: `bun run changeset` → commit → merge to `master` → merge the "Version packages" PR. jsDelivr serves `https://cdn.jsdelivr.net/npm/@nuni/widget@0/dist/nuni.global.js` automatically.

### 7. Smoke test in production

- [ ] `https://nuni.praveenjuge.com` loads, the Nuni toolbar appears, "Copy prompt" works.
- [ ] `https://nuni.praveenjuge.com/dashboard` → Sign in with GitHub → back on the dashboard, signed in (cookie on `nuni.praveenjuge.com`).
- [ ] In a fresh app: `npx @nuni/cli@latest init`, add the snippet, deploy to a preview URL, comment, reload, open in a second browser.
- [ ] Claim from the widget, allow owner tools, resolve a comment; confirm it updates in the dashboard, then **Jump to comment**.
- [ ] WorkOS → Webhooks shows successful deliveries; Convex → Data → `users` has your row.
