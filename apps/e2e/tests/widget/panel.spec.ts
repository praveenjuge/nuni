import { generateProjectId as projectId } from "@nuni/shared"
import { expect, test, type Page } from "@playwright/test"

const root = (page: Page) => page.locator("#nuni-root")
const panel = (page: Page) => root(page).locator(".panel")
const items = (page: Page) => panel(page).locator("button.item")
const openPanel = (page: Page) =>
  root(page).locator(".toolbar").getByRole("button", { name: /open/ }).click()

async function addComment(page: Page, plan: number, body: string) {
  await root(page)
    .locator(".toolbar")
    .getByRole("button", { name: "Add a comment" })
    .click()
  await page.locator(".plan").nth(plan).locator(".price").click()
  const composer = root(page).locator('[data-card="composer"]')
  const name = composer.getByPlaceholder("Your name")
  if (await name.isVisible()) await name.fill("Sam Visitor")
  await composer.getByPlaceholder("Leave a comment").fill(body)
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(root(page).locator(".toast")).toHaveText("Comment added")
}

test("the panel marks the comment opened last and searches comments", async ({
  page,
}) => {
  const project = projectId()
  const stamp = Date.now()
  await page.goto(`/pricing?project=${project}`)
  await addComment(page, 0, `Make the logo bigger ${stamp}`)
  await addComment(page, 1, `Fix the price typo ${stamp}`)

  // The comment opened from the panel stays marked after its card closes.
  await openPanel(page)
  await expect(items(page)).toHaveCount(2)
  await items(page).filter({ hasText: "price typo" }).click()
  await expect(root(page).locator('[data-card="thread"]')).toBeVisible()
  await page.keyboard.press("Escape")
  const current = panel(page).locator('button.item[aria-current="true"]')
  await expect(current).toHaveCount(1)
  await expect(current).toContainText("price typo")

  // And after a reload.
  await page.reload()
  await openPanel(page)
  await expect(current).toContainText("price typo")

  // Search filters by text and author; Escape clears it before closing.
  const search = panel(page).getByRole("searchbox", { name: "Search comments" })
  await search.fill("LOGO")
  await expect(items(page)).toHaveCount(1)
  await expect(items(page)).toContainText("logo bigger")
  await search.fill("nothing like this")
  await expect(items(page)).toHaveCount(0)
  await expect(panel(page)).toContainText(
    "No comments match “nothing like this”."
  )
  await search.fill("sam visitor")
  await expect(items(page)).toHaveCount(2)
  await page.keyboard.press("Escape")
  await expect(search).toHaveValue("")
  await expect(panel(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(panel(page)).toHaveCount(0)
})

test("Yours lists your comments on every page and opens them", async ({
  page,
  browser,
}) => {
  const project = projectId()
  const stamp = Date.now()
  await page.goto(`/pricing?project=${project}`)
  await addComment(page, 0, `Pricing note ${stamp}`)
  await page.goto(`/?project=${project}`)
  await root(page)
    .locator(".toolbar")
    .getByRole("button", { name: "Add a comment" })
    .click()
  await page.locator(".lead").click()
  const composer = root(page).locator('[data-card="composer"]')
  await composer.getByPlaceholder("Leave a comment").fill(`Home note ${stamp}`)
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(root(page).locator(".toast")).toHaveText("Comment added")

  await openPanel(page)
  const yours = panel(page).getByRole("tab", { name: "Yours (2)" })
  await yours.click()
  await expect(yours).toHaveAttribute("aria-selected", "true")
  const list = panel(page).getByRole("tabpanel")
  await expect(list.locator(".item")).toHaveCount(2)
  await expect(list.locator(".item").first()).toContainText("This page")
  await expect(list.locator(".item").first()).toContainText("Open")
  await expect(list.locator(".item").nth(1)).toContainText("/pricing")

  // A comment on another page opens there, focused.
  await list.getByRole("link", { name: /Pricing note/ }).click()
  await expect(page).toHaveURL(/\/pricing\?project=/)
  await expect(root(page).locator('[data-card="thread"]')).toContainText(
    `Pricing note ${stamp}`
  )

  // Someone else's browser has none of them.
  const other = await browser.newContext()
  const stranger = await other.newPage()
  await stranger.goto(`/pricing?project=${project}`)
  await openPanel(stranger)
  await panel(stranger).getByRole("tab", { name: "Yours (0)" }).click()
  await expect(panel(stranger)).toContainText(
    "Comments you leave on any page of this site show here."
  )
  await other.close()
})
