# Setup plan: local and production

Two environments only:

| Piece          | Local                                     | Production                                                                            |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Docs + landing | `http://localhost:4321`                   | `https://nuni.praveenjuge.com` (Vercel project `nuni-docs`)                           |
| Dashboard      | `http://localhost:3000/dashboard`         | `https://nuni.praveenjuge.com/dashboard` (rewrite to Vercel project `nuni-dashboard`) |
| Convex         | dev deployment                            | production deployment                                                                 |
| WorkOS         | Staging environment                       | Production environment                                                                |
| GitHub sign-in | WorkOS default credentials (staging only) | your own GitHub OAuth App                                                             |

Vercel only builds `master` (production). Preview deployments are skipped by `ignoreCommand` in both `vercel.json` files.

Sign-in uses hosted AuthKit, where users choose GitHub. WorkOS handles the email verification that new OAuth users may need before a session is created.

---

## Local

### 1. Accounts

- [ ] Convex account (https://dashboard.convex.dev)
- [ ] WorkOS account (https://dashboard.workos.com). Convex creates and manages a dedicated **Staging** environment for this deployment.

### 2. Convex dev deployment

```bash
bun install
cd packages/backend
npx convex dev
```

- [ ] Log in, create the project (for example `nuni`).
- [ ] Choose the Convex-managed WorkOS team. Convex provisions AuthKit and sets `WORKOS_CLIENT_ID` and `WORKOS_API_KEY` on the dev deployment. The redirect URI, homepage, and CORS origins are declared in `packages/backend/convex.json`.
- [ ] Note the dev URLs from `packages/backend/.env.local` or the Convex dashboard: `https://<dev>.convex.cloud` and `https://<dev>.convex.site`.

### 3. WorkOS staging

- [ ] In Convex → Settings → Integrations → WorkOS AuthKit, open the managed staging environment. Copy its Client ID and API key for the dashboard's local env file. Managed API key prefixes may differ from `sk_test_`.
- [ ] **Authentication → OAuth providers → GitHub → Manage**: enable it with the WorkOS default credentials.
- [ ] **Redirects** (Applications → your app → Redirects):
  - Redirect URI: `http://localhost:3000/dashboard/callback` (mark as default)
  - Sign-in endpoint (Initiate login URI): `http://localhost:3000/dashboard/sign-in`
  - Sign-out redirect / App homepage URL: `http://localhost:3000/dashboard`
- [ ] **Webhooks → Create endpoint**: `https://<dev>.convex.site/workos/webhook`, events `user.created`, `user.updated`, `user.deleted`. Copy the signing secret.

### 4. Convex dev environment variables

```bash
cd packages/backend
npx convex env set WORKOS_WEBHOOK_SECRET <signing secret>
npx convex env set NUNI_ALLOW_TESTING 1            # optional for e2e tests; never in production
npx convex dev                                     # now pushes successfully; keep it running
```

### 5. Local env files

`apps/dashboard/.env.local`:

```bash
WORKOS_CLIENT_ID=client_01...        # managed staging environment
WORKOS_API_KEY=<managed staging API key>
WORKOS_COOKIE_PASSWORD=<32+ random chars: openssl rand -base64 32>
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/dashboard/callback
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_CONVEX_URL=https://<dev>.convex.cloud
```

`apps/playground/.env.local`:

```bash
VITE_CONVEX_URL=https://<dev>.convex.cloud
VITE_CONVEX_SITE_URL=https://<dev>.convex.site
VITE_APP_URL=http://localhost:3000
```

For the docs site to run the widget against dev, export these before `bun run dev`:

```bash
export NUNI_CONVEX_URL=https://<dev>.convex.cloud
export NUNI_CONVEX_SITE_URL=https://<dev>.convex.site
export NUNI_APP_URL=http://localhost:3000
```

### 6. Run and check

```bash
bunx turbo run dev --filter=@nuni/dashboard --filter=@nuni/playground --filter=@nuniapp/widget --filter=@nuni/docs
```

- [ ] http://127.0.0.1:5173: press C, click something, post a comment. Reload; the pin comes back.
- [ ] Nuni panel → **Claim Nuni** → GitHub → **Allow on 127.0.0.1:5173**. The panel shows **Owner**; Resolve works.
- [ ] http://localhost:3000/dashboard lists the project; **Jump to comment** opens it.
- [ ] Convex dashboard (dev) → Data → `users` has your row (the webhook works).

No accounts at all? `CONVEX_AGENT_MODE=anonymous npx convex dev` runs a local backend at `127.0.0.1:3210`, which the widget and playground use by default. Set placeholder `WORKOS_*` values with `npx convex env set`. Everything except GitHub sign-in works.

---

## Production

### 1. GitHub OAuth App

WorkOS default GitHub credentials only work in staging.

- [ ] WorkOS **Production** → Authentication → OAuth providers → GitHub → Manage: copy the **Redirect URI** shown there.
- [ ] GitHub → Settings → Developer settings → **OAuth Apps → New OAuth App**:
  - Name `Nuni`, Homepage URL `https://nuni.praveenjuge.com`
  - Authorization callback URL: the WorkOS Redirect URI from above
- [ ] Generate a client secret. In WorkOS, choose "Your app's credentials", paste the GitHub Client ID and Secret, enable, save. Keep the `user:email` scope.

### 2. WorkOS production

- [ ] Add billing details to unlock Production, then in Convex → Production → Settings → Integrations → WorkOS AuthKit create the managed **Production** environment. Convex sets its Client ID and API key on the production deployment. WorkOS states OAuth connections are free and AuthKit is free up to 1 million monthly active users; other products and usage above that tier can incur charges.
- [ ] Copy the managed production Client ID and API key for Vercel. Do not infer the environment from the API key prefix.
- [ ] **Redirects**:
  - Redirect URI: `https://nuni.praveenjuge.com/dashboard/callback` (default; production requires HTTPS)
  - Sign-in endpoint: `https://nuni.praveenjuge.com/dashboard/sign-in`
  - Sign-out redirect / App homepage URL: `https://nuni.praveenjuge.com/dashboard`
- [ ] **Webhooks**: `https://<prod>.convex.site/workos/webhook`, events `user.created`, `user.updated`, `user.deleted`. Copy the signing secret.
- [ ] Leave the JWT template at its default (Convex validates the standard WorkOS session token).

### 3. Convex production

- [ ] Convex dashboard → project → **Production** deployment → Settings → Environment Variables: verify the managed `WORKOS_CLIENT_ID` and `WORKOS_API_KEY`, and set `WORKOS_WEBHOOK_SECRET`. Do not set `NUNI_ALLOW_TESTING`.
- [ ] Production deployment → Settings → **Generate Production Deploy Key** with the `deployment:deploy` permission.
- [ ] Note `https://<prod>.convex.cloud` and `https://<prod>.convex.site`.

### 4. Vercel project `nuni-dashboard`

- [ ] Import the GitHub repo. **Root Directory**: `apps/dashboard` (keep "Include files outside the root directory" on). `apps/dashboard/vercel.json` provides the install and build commands; the build runs `convex deploy`, which pushes the backend and injects `NEXT_PUBLIC_CONVEX_URL`.
- [ ] Environment Variables (Production):

| Variable                          | Value                                             |
| --------------------------------- | ------------------------------------------------- |
| `CONVEX_DEPLOY_KEY`               | production deploy key                             |
| `WORKOS_CLIENT_ID`                | production client ID                              |
| `WORKOS_API_KEY`                  | managed production API key                        |
| `WORKOS_COOKIE_PASSWORD`          | 32+ random characters                             |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | `https://nuni.praveenjuge.com/dashboard/callback` |
| `NEXT_PUBLIC_APP_URL`             | `https://nuni.praveenjuge.com`                    |

- [ ] Deploy. Note its production URL (for example `https://nuni-dashboard.vercel.app`). If it is different, update both rewrites in `apps/docs/vercel.json`.
- [ ] Settings → Deployment Protection: make sure production is not protected (the docs site proxies to it).
- [ ] Do not add a custom domain here; users reach it through `nuni.praveenjuge.com/dashboard`.

### 5. Vercel project `nuni-docs`

- [ ] Import the same repo. **Root Directory**: `apps/docs`. `apps/docs/vercel.json` provides the commands, the `dist` output and the `/dashboard` rewrites.
- [ ] Environment Variables (Production):
  - `NUNI_CONVEX_URL=https://<prod>.convex.cloud`
  - `NUNI_CONVEX_SITE_URL=https://<prod>.convex.site`
  - `NUNI_APP_URL=https://nuni.praveenjuge.com`
- [ ] **Domains**: add `nuni.praveenjuge.com`. In Cloudflare, add the CNAME target Vercel shows and leave **Proxy status off (DNS only)**. Verify that Vercel issues a certificate and the HTTPS site loads.

### 6. npm packages and releases

- [ ] Use the free public-package npm organization `@nuniapp` for `@nuniapp/widget`, `@nuniapp/react`, and `@nuniapp/cli`.
- [ ] In each package's npm **Settings → Trusted Publisher**, allow direct `npm publish` from GitHub Actions, repository `praveenjuge/nuni`, workflow filename `release.yml`. No npm token is needed.
- [ ] GitHub repo → Settings → Secrets and variables → Actions:
  - Variables `NUNI_CONVEX_URL` and `NUNI_CONVEX_SITE_URL`: the production Convex URLs. The release job stays off until these exist. No release secret is needed.
  - Optional: secret `TURBO_TOKEN` and variable `TURBO_TEAM` for remote caching.
- [ ] To release, change only `version` in the root `package.json` to a new semver value and merge it to `master`. The release workflow syncs all three public package versions and the React widget dependency, commits the updated manifests and lockfile, builds them, and publishes each new version through npm trusted publishing. Check the GitHub Actions run and npm package pages before using the new version. jsDelivr serves `https://cdn.jsdelivr.net/npm/@nuniapp/widget@0/dist/nuni.global.js`.

### 7. Production smoke test

- [ ] `https://nuni.praveenjuge.com` loads; the Nuni toolbar appears; "Copy prompt" works.
- [ ] `https://nuni.praveenjuge.com/dashboard` → Sign in → GitHub in AuthKit → complete email verification if prompted → back on the dashboard, signed in.
- [ ] In a fresh app: `npx @nuniapp/cli@latest init`, add the snippet, deploy it anywhere, comment, reload, open in a second browser.
- [ ] Claim from the widget, allow owner tools, resolve a comment; the dashboard updates live; **Jump to comment** works.
- [ ] WorkOS → Webhooks shows successful deliveries; Convex (prod) → Data → `users` has your row.

## If something fails

- **Signed in, but the dashboard shows nothing / Convex says unauthenticated**: `WORKOS_CLIENT_ID` in Convex must match the one in Vercel (same environment), and the backend must have been redeployed after setting it.
- **"redirect_uri is invalid"**: the Redirect URI in WorkOS must exactly match `NEXT_PUBLIC_WORKOS_REDIRECT_URI`.
- **Convex push fails with "Missing environment variables"**: set all three `WORKOS_*` variables on that Convex deployment.
- **Cookie lands on the wrong domain**: `NEXT_PUBLIC_APP_URL` must be `https://nuni.praveenjuge.com`.
