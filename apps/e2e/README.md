# Product end-to-end tests

From the repository root:

```bash
bun install
bunx playwright install chromium
bun run e2e
```

The suite starts WorkOS Emulate (4100), anonymous Convex (3210/3211), the playground (5173), dashboard (3000), and docs (4321). It signs in through the emulator UI and saves owner sessions in `.auth/`. No production credentials are required. Keep these ports free; use `CHROMIUM_PATH=/path/to/chrome` for an existing Chromium installation.

Test users live in `workos-emulate.config.yaml`. The committed signing key is disposable local test data. Backend source is copied into a fresh ignored `.runtime/` directory per run; deployment selection never reads the developer backend environment or provisions hosted AuthKit. The suite refuses a non-anonymous backend. All test helpers are guarded by `NUNI_ALLOW_TESTING`; they must never be enabled in production.

Use `fixtures.ts` for an authenticated `ownerPage`, a unique `projectId`, and `convexRun`. Widget regression tests retain `testing:seedOwner` for isolated widget sessions. New dashboard, claim, CLI, MCP, and journey specs use real emulator sign-in. The migrated widget CLI regression retains seeded approval to test its original command behavior.

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
