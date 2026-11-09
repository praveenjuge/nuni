# Product end-to-end tests

From the repository root:

```bash
bun install
bunx playwright install chromium
bun run e2e
```

The suite starts WorkOS Emulate (4100), anonymous Convex (3310/3311, so a dev backend on 3210 can keep running), the playground (5173), dashboard (3000), and docs (4321). Every port, URL and local credential is in `env.ts`. It signs in through the emulator UI and saves owner sessions in `.auth/`. No production credentials are required. Keep these ports free; use `CHROMIUM_PATH=/path/to/chrome` for an existing Chromium installation.

Test users live in `workos-emulate.config.yaml`; `scripts/workos-emulate.ts` starts the emulator with them. The committed signing key is disposable local test data. `scripts/setup-convex.ts` copies the backend source into a fresh ignored `.runtime/backend` on each run; deployment selection never reads the developer backend environment or provisions hosted AuthKit. The suite refuses a non-anonymous backend. All test helpers are guarded by `NUNI_ALLOW_TESTING`; they must never be enabled in production.

Write specs with `fixtures.ts`: a unique `projectId` per test, `widget` (the widget on `page` for that project), `newVisitor()` for another browser, `ownerWidget` for a browser holding the project's owner session (seeded with `testing:seedOwner`), and the signed-in dashboard pages `ownerPage` and `secondOwnerPage`. `widget.ts` is the only place that knows the widget's DOM; `helpers.ts` has the dashboard flows (`signIn`, `claimProject`) and `cliSession` for the built CLI and its MCP server.

`tests/release/` checks a published release against production instead (see the root README); it runs only when `NUNI_RELEASE_VERSION` is set.

## Debug

```bash
bun run --cwd apps/e2e e2e:ui
bun run --cwd apps/e2e e2e:headed
bun run --cwd apps/e2e e2e -- tests/dashboard --debug
bunx playwright show-report apps/e2e/playwright-report
bunx playwright show-trace apps/e2e/test-results/<test>/trace.zip
```

Failed tests retain traces and screenshots. CI uploads the HTML report and test results when the suite fails. A single worker keeps the shared backend deterministic; unique IDs isolate projects across repeated runs.

## Test agents

Run agents from this directory so they find `.claude/agents/` and `.mcp.json`:

- `playwright-test-planner`: explore a flow and write its Markdown plan under `specs/`.
- `playwright-test-generator`: turn the plan into specs using `tests/seed.spec.ts` and shared fixtures.
- `playwright-test-healer`: reproduce failures and fix selectors or product behavior while preserving assertions.

These definitions come from `bunx playwright init-agents --loop=claude`. Generated tests are ordinary Playwright specs; CI runs without an LLM. Every user-facing feature or bug fix needs coverage in `tests/<area>/`. Prefer roles and labels, wait for observable state, and avoid fixed sleeps.

The interactive CLI skill is installed in `.claude/skills/playwright-cli/`. With the apps running, use:

```bash
cd apps/e2e
bunx playwright-cli open http://localhost:3000/dashboard
bunx playwright-cli snapshot
```

Use the skill for interactive inspection; put repeatable assertions in the deterministic suite. Refresh its definitions with `bunx playwright-cli install --skills`.
