import { mkdirSync, writeFileSync } from "node:fs"

import { CLI_NPX, generateProjectId } from "@nuni/shared"
import type { Page } from "@playwright/test"

import {
  CAPTURED_ATTRIBUTES,
  TEST_ID_ATTRIBUTES,
} from "../../../../packages/anchor/src/stable"
import { URLS } from "../../env"
import { expect, test } from "../../fixtures"
import { cliSession } from "../../helpers"

// The docs restate what the code decides; these fail when they drift.

/** The text of a docs page's code: inline and blocks. */
async function codeOn(page: Page, route: string) {
  await page.goto(`${URLS.docs}${route}`)
  return page.getByRole("main").locator("code").allTextContents()
}

test("How pins stay put lists every attribute a pin records", async ({
  page,
}) => {
  const code = await codeOn(page, "/guides/how-pins-work")
  for (const name of [...TEST_ID_ATTRIBUTES, ...CAPTURED_ATTRIBUTES])
    expect(code, `${name} is missing`).toContain(name)
})

test("the CLI reference shows every command's usage", async ({
  page,
}, testInfo) => {
  const { commands } = JSON.parse(
    await cliSession(testInfo).run("help", "--json")
  ) as { commands: { usage: string }[] }
  const code = (await codeOn(page, "/reference/cli")).join("\n")
  for (const { usage } of commands)
    expect(code).toContain(`${CLI_NPX} ${usage}`)
})

test("the agents guide lists every MCP tool", async ({ page }, testInfo) => {
  const client = await cliSession(testInfo).mcp()
  const { tools } = await client.listTools().finally(() => client.close())
  const code = await codeOn(page, "/guides/agents")
  for (const { name } of tools) expect(code).toContain(name)
})

test("Any JavaScript app shows the snippets `init` prints", async ({
  page,
}, testInfo) => {
  const code = (await codeOn(page, "/install/javascript")).join("\n")
  const id = generateProjectId()
  for (const dependency of ["nuxt", "@sveltejs/kit", "astro"]) {
    const dir = testInfo.outputPath(dependency.replace(/\W/g, ""))
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      `${dir}/package.json`,
      JSON.stringify({ dependencies: { [dependency]: "*" } })
    )
    const { snippet } = JSON.parse(
      await cliSession(testInfo).run("init", "--json", "--id", id, "--cwd", dir)
    ) as { snippet: string }
    expect(code).toContain(snippet.replaceAll(id, "nuni_..."))
  }
})
