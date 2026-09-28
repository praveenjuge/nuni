# Nuni monorepo

Turborepo + Bun workspaces. See README.md for the layout and commands.

- `apps/dashboard` is Next.js 16 with breaking changes from older versions. Read `apps/dashboard/AGENTS.md` and the docs in `apps/dashboard/node_modules/next/dist/docs/` before changing it. It uses `proxy.ts` (not middleware) and `basePath: "/dashboard"`.
- `apps/docs` is a Blume site (Markdown in `apps/docs/docs`). Docs for Blume: https://useblume.dev/llms.txt
- Backend is Convex in `packages/backend/convex`. Regenerate `_generated` with `npx convex dev` (or `CONVEX_AGENT_MODE=anonymous npx convex dev --once` locally). Test with `bun run --cwd packages/backend test`.
- Pin reliability is the top priority. Any change to `packages/anchor` must keep `bun run bench` green (≥95% correct, ≤1 wrong).
- The agent prompt lives in `packages/shared/src/prompt.ts`. After editing it run `bun run readmes`.
- Run `bunx turbo run build lint typecheck test` and `bun run format:check` before pushing.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
