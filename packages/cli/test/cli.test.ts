import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isProjectId } from "@nuni/shared"
import { describe, expect, it } from "vitest"

import packageJson from "../package.json"
import { run } from "../src/cli"
import { detectSetup } from "../src/frameworks"

const ID = "nuni_JJHAES8DaHHYNVh4JoWWXw"

function project(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "nuni-cli-"))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return dir
}

const pkg = (deps: Record<string, string>) =>
  JSON.stringify({ dependencies: deps })

/** Runs the CLI with no backend, capturing output. */
async function cli(...argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await run(argv, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  })
  return { code, out, err }
}

describe("detectSetup", () => {
  it.each([
    [
      {
        "package.json": pkg({ next: "16", react: "19" }),
        "app/layout.tsx": "",
      },
      "next-app",
      "app/layout.tsx",
    ],
    [
      { "package.json": pkg({ next: "16" }), "src/app/layout.tsx": "" },
      "next-app",
      "src/app/layout.tsx",
    ],
    [
      { "package.json": pkg({ next: "14" }), "pages/_app.tsx": "" },
      "next-pages",
      "pages/_app.tsx",
    ],
    [{ "package.json": pkg({ next: "16" }) }, "next-app", "app/layout.tsx"],
    [
      { "package.json": pkg({ react: "19", vite: "8" }), "src/main.tsx": "" },
      "react",
      "src/main.tsx",
    ],
    [
      { "package.json": pkg({ "react-router": "7" }) },
      "react-router",
      "app/root.tsx",
    ],
    [
      { "package.json": pkg({ "@tanstack/react-start": "1" }) },
      "tanstack-start",
      "src/routes/__root.tsx",
    ],
    [{ "package.json": pkg({ vue: "3" }) }, "vue", "src/main.ts"],
    [{ "package.json": pkg({ nuxt: "4" }) }, "nuxt", "plugins/nuni.client.ts"],
    [
      { "package.json": pkg({ "@sveltejs/kit": "2" }) },
      "sveltekit",
      "src/routes/+layout.svelte",
    ],
    [
      { "package.json": pkg({ astro: "7" }) },
      "astro",
      "src/layouts/Layout.astro",
    ],
    [{ "package.json": pkg({}) }, "vanilla", "src/main.ts"],
    [{ "index.html": "<html></html>" }, "html", "index.html"],
    [{ "about.html": "<html></html>" }, "html", "about.html"],
  ])("detects %#", (files, frameworkId, file) => {
    expect(detectSetup(project(files), ID)).toMatchObject({ frameworkId, file })
  })

  it.each([
    ["bun.lock", "bun add @nuniapp/widget@latest"],
    ["pnpm-lock.yaml", "pnpm add @nuniapp/widget@latest"],
    ["yarn.lock", "yarn add @nuniapp/widget@latest"],
    ["package-lock.json", "npm install @nuniapp/widget@latest"],
  ])("installs with the package manager of %s", (lockfile, install) => {
    const dir = project({ "package.json": pkg({ vue: "3" }), [lockfile]: "" })
    expect(detectSetup(dir, ID).install).toBe(install)
  })

  it("needs no install for static HTML", () => {
    const setup = detectSetup(project({ "index.html": "" }), ID)
    expect(setup.install).toBeNull()
    expect(setup.snippet).toContain(`data-project="${ID}"`)
  })
})

describe("init", () => {
  it("prints the setup as JSON for agents", async () => {
    const dir = project({
      "package.json": pkg({ next: "16" }),
      "app/layout.tsx": "",
      "bun.lock": "",
    })
    const { code, out } = await cli("init", "--json", "--cwd", dir)
    expect(code).toBe(0)
    const setup = JSON.parse(out[0]!)
    expect(setup).toMatchObject({
      framework: "Next.js (App Router)",
      frameworkId: "next-app",
      file: "app/layout.tsx",
      package: "@nuniapp/react",
      install: "bun add @nuniapp/react@latest",
    })
    expect(isProjectId(setup.projectId)).toBe(true)
    expect(setup.snippet).toContain(setup.projectId)
  })

  it("is the default command, and prints the steps", async () => {
    const dir = project({ "package.json": pkg({ vue: "3" }) })
    const { code, out } = await cli("--cwd", dir, "--id", ID)
    expect(code).toBe(0)
    expect(out[0]).toContain(`Project ID   ${ID}`)
    expect(out[0]).toContain(
      "1. Install\n   npm install @nuniapp/widget@latest"
    )
  })

  it("reuses a given id and rejects invalid ones", async () => {
    const prompt = await cli("prompt", "--id", ID)
    expect(prompt.code).toBe(0)
    expect(prompt.out[0]).toContain(`Use this Nuni project ID: ${ID}`)

    const bad = await cli("init", "--project", "bad")
    expect(bad.code).toBe(1)
    expect(bad.out).toEqual([])
    expect(bad.err[0]).toContain('"bad" is not a valid Nuni project ID')
  })

  it("prints a fresh id, as text or JSON", async () => {
    const text = await cli("id")
    expect(isProjectId(text.out[0]!)).toBe(true)
    const json = await cli("id", "--json")
    expect(isProjectId(JSON.parse(json.out[0]!).projectId)).toBe(true)
  })
})

describe("help and version", () => {
  it("lists every command", async () => {
    const { code, out } = await cli("--help")
    expect(code).toBe(0)
    for (const name of [
      "init",
      "prompt",
      "id",
      "login",
      "whoami",
      "comments",
      "pages",
      "comment",
      "reply",
      "resolve",
      "reopen",
      "logout",
      "mcp",
    ]) {
      expect(out[0]).toMatch(new RegExp(`^  ${name}\\b`, "m"))
    }
    expect((await cli("help")).out).toEqual(out)
  })

  it("explains one command, without running it", async () => {
    for (const argv of [
      ["resolve", "--help"],
      ["help", "resolve"],
    ]) {
      const { code, out } = await cli(...argv)
      expect(code).toBe(0)
      expect(out[0]).toContain(`resolve <id...> [--note "what changed"]`)
    }
  })

  it("prints the version for any command, without running it", async () => {
    expect((await cli("--version")).out).toEqual([packageJson.version])
    expect((await cli("comments", "-v")).out).toEqual([packageJson.version])
    expect(JSON.parse((await cli("-v", "--json")).out[0]!)).toEqual({
      version: packageJson.version,
    })
  })

  it("rejects unknown commands and flags", async () => {
    const command = await cli("nope")
    expect(command.code).toBe(1)
    expect(command.err[0]).toContain('Unknown command "nope"')
    const flag = await cli("comments", "--nope", "--json")
    expect(flag.code).toBe(1)
    expect(JSON.parse(flag.err[0]!).error.message).toContain("--nope")
  })
})
