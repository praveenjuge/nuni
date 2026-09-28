import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { detectFramework, detectPackageManager, installCommand } from "../src/detect"
import { run } from "../src/cli"
import { snippetFor } from "../src/snippets"

function project(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "nuni-cli-"))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return dir
}

const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps })

describe("detectFramework", () => {
  it.each([
    [{ "package.json": pkg({ next: "16", react: "19" }), "app/layout.tsx": "" }, "next-app", "app/layout.tsx"],
    [{ "package.json": pkg({ next: "16" }), "src/app/layout.tsx": "" }, "next-app", "src/app/layout.tsx"],
    [{ "package.json": pkg({ next: "14" }), "pages/_app.tsx": "" }, "next-pages", "pages/_app.tsx"],
    [{ "package.json": pkg({ react: "19", vite: "8" }), "src/main.tsx": "" }, "react", "src/main.tsx"],
    [{ "package.json": pkg({ "react-router": "7" }) }, "react-router", "app/root.tsx"],
    [{ "package.json": pkg({ "@tanstack/react-start": "1" }) }, "tanstack-start", "src/routes/__root.tsx"],
    [{ "package.json": pkg({ vue: "3" }) }, "vue", "src/main.ts"],
    [{ "package.json": pkg({ nuxt: "4" }) }, "nuxt", "plugins/nuni.client.ts"],
    [{ "package.json": pkg({ "@sveltejs/kit": "2" }) }, "sveltekit", "src/routes/+layout.svelte"],
    [{ "package.json": pkg({ astro: "7" }) }, "astro", "src/layouts/Layout.astro"],
    [{ "index.html": "<html></html>" }, "html", "index.html"],
  ])("detects %#", (files, id, file) => {
    const fw = detectFramework(project(files as Record<string, string>))
    expect(fw.id).toBe(id)
    expect(fw.file).toBe(file)
  })
})

describe("package manager", () => {
  it("detects lockfiles", () => {
    expect(detectPackageManager(project({ "bun.lock": "" }))).toBe("bun")
    expect(detectPackageManager(project({ "pnpm-lock.yaml": "" }))).toBe("pnpm")
    expect(detectPackageManager(project({ "yarn.lock": "" }))).toBe("yarn")
    expect(detectPackageManager(project({}))).toBe("npm")
    expect(installCommand("pnpm", "@nuni/react")).toBe("pnpm add @nuni/react")
  })
})

describe("snippets", () => {
  it("embeds the id", () => {
    const fw = { id: "html", name: "", kind: "script" as const, file: "index.html" }
    expect(snippetFor(fw, "nuni_abc")).toContain('data-project="nuni_abc"')
  })
})

describe("run", () => {
  afterEach(() => vi.restoreAllMocks())

  it("prints json for agents", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const dir = project({ "package.json": pkg({ next: "16" }), "app/layout.tsx": "", "bun.lock": "" })
    expect(run(["init", "--json", "--cwd", dir])).toBe(0)
    const out = JSON.parse(log.mock.calls[0]![0] as string)
    expect(out).toMatchObject({ frameworkId: "next-app", package: "@nuni/react", install: "bun add @nuni/react" })
    expect(out.projectId).toMatch(/^nuni_/)
    expect(out.snippet).toContain(out.projectId)
  })

  it("reuses a given id and rejects invalid ones", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(run(["prompt", "--id", "nuni_JJHAES8DaHHYNVh4JoWWXw"])).toBe(0)
    expect(log.mock.calls[0]![0]).toContain("nuni_JJHAES8DaHHYNVh4JoWWXw")
    expect(run(["init", "--id", "bad"])).toBe(1)
    expect(err).toHaveBeenCalled()
  })

  it("prints a fresh id", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    expect(run(["id"])).toBe(0)
    expect(log.mock.calls[0]![0]).toMatch(/^nuni_[1-9A-HJ-NP-Za-km-z]{22}$/)
  })
})
