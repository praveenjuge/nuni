# Product coverage

Seed: `tests/seed.spec.ts`. Owners come from `workos-emulate.config.yaml` and sign in through the password UI. Use `fixtures.ts` and a fresh project ID for every flow.

1. Auth: password login lands on Projects; sign out removes access. Claim sign-in preserves `returnTo`. A new WorkOS API user reaches Convex through the signed webhook before any dashboard login.
2. Claim: a visitor posts feedback. The signed-in owner's widget popup claims the site and hands back a session. Resolve becomes available and removes the visitor's open pin live.
3. Dashboard: claimed project and visitor comments appear. Resolve/reopen updates the widget. Rename and allowed origins persist across reloads. Delete removes the project. Transfer grants the second owner access, revokes the first, and cannot be reused. A missing page links back to Projects.
4. CLI and MCP: the owner approves the terminal's displayed code in the dashboard. Commands list, inspect, reply, resolve, and sign out. The SDK stdio client lists feedback, replies, and resolves with the same credentials.
5. Docs: key routes render meaningful content; crawl local links with no missing pages. The embedded widget opens against the local backend. Vercel-only dashboard rewrites are outside local coverage.
6. README journey: init generates a valid ID; visitor comments; owner claims and sees feedback; MCP replies and resolves; the widget reflects both live. Save a screenshot as a repeatable artifact.
7. Widget regressions: retain existing accessibility, anchoring, scopes, context, threads, annotations, owner tools, and command behavior coverage.

Use role and label locators. Assert visible outcomes and persisted behavior; avoid fixed waits. Run twice to check isolation. CI retains HTML reports, traces, and failure screenshots.
