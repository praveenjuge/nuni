import { expect, test } from "../../fixtures"

// A React app with no router whose content keeps re-rendering (a ticking
// counter). Clicking a comment in the panel must still jump to its pin.
test("comments in the panel open on a page without a router", async ({
  page,
  projectId,
}) => {
  await page.goto(`/no-router.html?project=${projectId}`)
  const root = page.locator("#nuni-root")
  await expect(root.locator(".toolbar")).toBeVisible()

  await root.getByRole("button", { name: "Add a comment", exact: true }).click()
  await page.getByRole("heading", { name: "Support" }).click()
  const composer = root.locator('[data-card="composer"]')
  await composer.getByPlaceholder("Your name").fill("Router Free")
  await composer
    .getByPlaceholder("Leave a comment")
    .fill("Check the support copy")
  await composer.getByRole("button", { name: "Post", exact: true }).click()
  await expect(root.locator(".toast")).toHaveText("Comment added")

  const thread = root.locator('[data-card="thread"]')
  const pinInView = () =>
    expect
      .poll(async () => {
        const box = await root.locator('.pin[data-active="true"]').boundingBox()
        const height = page.viewportSize()!.height
        return Boolean(box && box.y > 0 && box.y + box.height < height)
      })
      .toBe(true)

  await root.locator(".toolbar").getByRole("button", { name: /open/ }).click()
  const item = root.locator(".panel .item", {
    hasText: "Check the support copy",
  })
  // A held press, like a person's: the page re-renders while it is down.
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, 0))
    await item.click({ delay: 150 })
    await expect(thread).toContainText("Check the support copy")
    await pinInView()
    await page.keyboard.press("Escape")
    await expect(thread).toBeHidden()
  }

  // The dashboard's jump link opens the same comment on this page.
  const id = (await item.getAttribute("data-focus-key"))!.replace("item-", "")
  await page.goto(`/no-router.html?project=${projectId}&nuni=${id}`)
  await expect(thread).toContainText("Check the support copy")
  await pinInView()
})
