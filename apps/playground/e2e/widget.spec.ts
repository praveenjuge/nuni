import { expect, test, type Page } from "@playwright/test"

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
function projectId() {
  let id = "nuni_"
  for (let i = 0; i < 22; i++) id += ALPHABET[Math.floor(Math.random() * 58)]
  return id
}

const toolbar = (page: Page) => page.locator("#nuni-root .toolbar")
const commentButton = (page: Page) =>
  toolbar(page).getByRole("button", { name: "Add a comment" })
const pins = (page: Page) => page.locator("#nuni-root .pin:not(.pin-draft)")

async function addComment(
  page: Page,
  target: ReturnType<Page["locator"]>,
  body: string,
  name?: string
) {
  await commentButton(page).click()
  await target.click()
  const composer = page.locator('#nuni-root [data-card="composer"]')
  await expect(composer).toBeVisible()
  if (name) await composer.getByPlaceholder("Your name").fill(name)
  await composer.getByPlaceholder("Leave a comment").fill(body)
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(page.locator("#nuni-root .toast")).toHaveText("Comment added")
}

test("comment, persist, sync live, edit own, navigate", async ({
  page,
  browser,
}) => {
  const unique = `Make this bigger ${Date.now()}`
  const project = projectId()
  await page.goto(`/pricing?project=${project}`)
  await expect(toolbar(page)).toBeVisible()

  const target = page
    .locator(".plan")
    .nth(1)
    .getByRole("button", { name: "Choose plan" })
  const before = 0
  await addComment(page, target, unique, "Sam Tester")

  // The pin sits on the element that was clicked.
  await expect(pins(page)).toHaveCount(before + 1)
  const pin = pins(page).filter({ hasText: "ST" }).last()
  await expect(pin).toBeVisible()
  const pinBox = (await pin.boundingBox())!
  const targetBox = (await target.boundingBox())!
  expect(pinBox.x).toBeGreaterThan(targetBox.x - 5)
  expect(pinBox.x).toBeLessThan(targetBox.x + targetBox.width)

  // A second visitor sees it live, without reloading.
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await otherPage.goto(`/pricing?project=${project}`)
  await expect(pins(otherPage)).toHaveCount(before + 1)

  const second = `Second ${Date.now()}`
  await addComment(page, page.locator(".plan").nth(2).locator(".price"), second)
  await expect(pins(otherPage)).toHaveCount(before + 2)

  // Reload: pins persist and re-anchor.
  await page.reload()
  await expect(pins(page)).toHaveCount(before + 2)

  // Author can edit their own comment; the other visitor can't.
  await page
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: /open/ })
    .click()
  await page.locator("#nuni-root .panel").getByText(unique).click()
  const thread = page.locator('#nuni-root [data-card="thread"]')
  await expect(thread).toContainText(unique)
  await thread.getByRole("button", { name: "Edit" }).click()
  await thread.locator("textarea").fill(`${unique} (edited)`)
  await thread.getByRole("button", { name: "Save" }).click()
  await expect(thread).toContainText("(edited)")
  await expect(otherPage.locator("#nuni-root")).toBeAttached()

  await otherPage
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: /open/ })
    .click()
  await otherPage
    .locator("#nuni-root .panel")
    .getByText(`${unique} (edited)`)
    .click()
  const otherThread = otherPage.locator('#nuni-root [data-card="thread"]')
  await expect(otherThread).toBeVisible()
  await expect(otherThread.getByRole("button", { name: "Edit" })).toHaveCount(0)
  await expect(
    otherThread.getByRole("button", { name: "Resolve" })
  ).toHaveCount(0)

  // SPA navigation swaps the page's comments; other pages are listed.
  await page.keyboard.press("Escape") // closes the thread
  await page.keyboard.press("Escape") // closes the panel
  await expect(page.locator("#nuni-root .panel")).toHaveCount(0)
  await page.getByRole("link", { name: "Tasks" }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(pins(page)).toHaveCount(0)
  const panel = page.locator("#nuni-root .panel")
  if (!(await panel.isVisible())) {
    await page
      .locator("#nuni-root .toolbar")
      .getByRole("button", { name: /open/ })
      .click()
  }
  await expect(panel).toContainText("/pricing")

  // Deleting own comment removes it for everyone.
  await page.goto("/pricing")
  await page
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: /open/ })
    .click()
  await page.locator("#nuni-root .panel").getByText(second).click()
  page.once("dialog", (d) => d.accept())
  await page
    .locator('#nuni-root [data-card="thread"]')
    .getByRole("button", { name: "Delete" })
    .click()
  await expect(pins(otherPage)).toHaveCount(before + 1)
  await other.close()
})

test("keyboard shortcut and escape", async ({ page }) => {
  await page.goto("/")
  await expect(toolbar(page)).toBeVisible()
  await page.keyboard.press("c")
  await expect(page.locator("#nuni-root .pick-hint")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator("#nuni-root .pick-hint")).toHaveCount(0)
})

test("clicks in comment mode don't trigger the page", async ({ page }) => {
  await page.goto("/")
  await expect(toolbar(page)).toBeVisible()
  await commentButton(page).click()
  await page.getByRole("link", { name: "See pricing" }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('#nuni-root [data-card="composer"]')).toBeVisible()
})

test("mobile: tap to place, bottom sheet composer", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()
  await page.goto("/")
  await expect(toolbar(page)).toBeVisible()
  await commentButton(page).tap()
  await page.locator(".feature").first().locator("h3").tap()
  const composer = page.locator('#nuni-root [data-card="composer"]')
  await expect(composer).toBeVisible()
  await expect(composer).toHaveClass(/sheet/)
  const box = (await composer.boundingBox())!
  expect(Math.round(box.width)).toBe(390)
  await context.close()
})
