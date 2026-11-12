# Product coverage

Seed: `tests/seed.spec.ts`. Owners come from `workos-emulate.config.yaml` and sign in through the password UI. Use `fixtures.ts` and a fresh project ID for every flow.

1. Auth: password login lands on Projects; sign out removes access. Claim sign-in preserves `returnTo`. A new WorkOS API user reaches Convex through the signed webhook before any dashboard login.
2. Claim: a visitor posts feedback. The signed-in owner's widget popup claims the site and hands back a session; a session posted by any other origin is ignored. Resolve becomes available and removes the visitor's open pin live.
3. Dashboard: claimed project and visitor comments appear. Resolve/reopen updates the widget. Rename and allowed origins persist across reloads. The owner picks how often to be emailed; the email lists a visitor's comment, and its unsubscribe link turns the emails off without signing in. Delete removes the project. Transfer grants the second owner access, revokes the first, and cannot be reused. A missing page links back to Projects.
4. CLI and MCP: the owner approves the terminal's displayed code in the dashboard. Commands list, search, inspect, reply, resolve, and sign out; MCP tools list pages, search and resolve several at once.
5. Docs: key routes render meaningful content; crawl local links with no missing pages. The embedded widget opens against the local backend. Vercel-only dashboard rewrites are outside local coverage.
6. README journey: init generates a valid ID; visitor comments; owner claims and sees feedback; the SDK stdio MCP client lists, replies and resolves; the widget reflects both live. Save a screenshot as a repeatable artifact.
7. Widget: accessibility, options, anchoring, scopes, context, threads, annotations and owner tools, through the page object in `widget.ts`.
8. Release (`tests/release/`, only with `NUNI_RELEASE_VERSION`): the published packages and CDN script against production.

Use role and label locators. Assert visible outcomes and persisted behavior; avoid fixed waits. Run twice to check isolation. CI retains HTML reports, traces, and failure screenshots.
