import { test, expect } from "../../fixtures"

const docsURL = "http://localhost:4321"
const routes = [
  "/",
  "/quickstart",
  "/install/react",
  "/install/javascript",
  "/install/script-tag",
  "/guides/claiming",
  "/guides/dashboard",
  "/guides/agents",
  "/guides/environments",
  "/guides/how-pins-work",
  "/reference/options",
  "/reference/cli",
  "/faq",
  "/privacy",
]

for (const route of routes) {
  test(`docs render ${route}`, async ({ page }) => {
    const response = await page.goto(`${docsURL}${route}`)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole("main")).toBeVisible()
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
  })
}

test("crawl internal documentation links without dead ends", async ({
  page,
  request,
}) => {
  const pending = new Set(routes.map((route) => `${docsURL}${route}`))
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
      if (target.origin !== docsURL || target.pathname.startsWith("/dashboard"))
        continue
      target.hash = ""
      if (visited.has(target.href)) continue
      const result = await request.get(target.href)
      expect(result.ok(), target.href).toBe(true)
      if (result.headers()["content-type"]?.includes("text/html"))
        pending.add(target.href)
    }
  }
  expect(visited.size).toBeGreaterThanOrEqual(routes.length)
})

test("embedded feedback widget opens on the docs site", async ({ page }) => {
  await page.goto(docsURL)
  const toolbar = page.locator("#nuni-root .toolbar")
  await expect(toolbar).toBeVisible()
  await toolbar.getByRole("button", { name: /open/ }).click()
  await expect(page.locator("#nuni-root .panel")).toBeVisible()
})
