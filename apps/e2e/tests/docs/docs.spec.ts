import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  CAPTURED_ATTRIBUTES,
  TEST_ID_ATTRIBUTES,
} from "../../../../packages/anchor/src/stable"
import { URLS } from "../../env"
import { expect, test } from "../../fixtures"
import { Widget } from "../../widget"

/** Every page in apps/docs/docs, by its route. */
const routes = readdirSync(
  fileURLToPath(new URL("../../../docs/docs", import.meta.url)),
  { recursive: true, encoding: "utf8" }
)
  .filter((file) => file.endsWith(".mdx"))
  .map((file) => `/${file.replace(/\.mdx$/, "").replace(/(^|\/)index$/, "")}`)
  .sort()

for (const route of routes) {
  test(`docs render ${route}`, async ({ page }) => {
    const response = await page.goto(`${URLS.docs}${route}`)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole("main")).toBeVisible()
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
  })
}

test("internal documentation links all lead somewhere", async ({
  page,
  request,
}) => {
  const pending = new Set(routes.map((route) => `${URLS.docs}${route}`))
  const visited = new Set<string>()
  while (pending.size) {
    const url = pending.values().next().value!
    pending.delete(url)
    if (visited.has(url)) continue
    visited.add(url)
    const response = await page.goto(url)
    expect(response?.status(), url).toBe(200)
    const links = await page
      .getByRole("link")
      .evaluateAll((elements) =>
        elements.map((element) => (element as HTMLAnchorElement).href)
      )
    for (const href of links) {
      const target = new URL(href)
      if (
        target.origin !== URLS.docs ||
        target.pathname.startsWith("/dashboard")
      )
        continue
      target.hash = ""
      if (visited.has(target.href)) continue
      const result = await request.get(target.href)
      expect(result.ok(), target.href).toBe(true)
      if (result.headers()["content-type"]?.includes("text/html"))
        pending.add(target.href)
    }
  }
})

test("How pins stay put lists every attribute a pin records", async ({
  page,
}) => {
  await page.goto(`${URLS.docs}/guides/how-pins-work`)
  const main = page.getByRole("main")
  for (const name of [...TEST_ID_ATTRIBUTES, ...CAPTURED_ATTRIBUTES])
    await expect(
      main.locator("code", { hasText: new RegExp(`^${name}$`) }),
      `${name} is missing`
    ).not.toHaveCount(0)
})

test("embedded feedback widget opens on the docs site", async ({ page }) => {
  await page.goto(URLS.docs)
  // The docs use their own project, not the test's.
  const widget = new Widget(page, "")
  await widget.openPanel()
})
