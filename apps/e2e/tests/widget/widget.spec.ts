import { expect, test } from "../../fixtures"
import { choosePlan } from "../../helpers"

test("comment, persist, sync live, edit own, navigate", async ({
  widget,
  newVisitor,
}) => {
  const unique = `Make this bigger ${Date.now()}`
  const page = widget.page
  await widget.goto("/pricing")

  const target = choosePlan(page, 1)
  await widget.comment(target, unique, { name: "Sam Tester" })

  // The pin sits on the element that was clicked.
  await expect(widget.pins).toHaveCount(1)
  const pin = widget.pins.filter({ hasText: "ST" })
  await expect(pin).toBeVisible()
  const pinBox = (await pin.boundingBox())!
  const targetBox = (await target.boundingBox())!
  expect(pinBox.x).toBeGreaterThan(targetBox.x - 5)
  expect(pinBox.x).toBeLessThan(targetBox.x + targetBox.width)

  // A second visitor sees it live, without reloading.
  const other = await newVisitor()
  await other.goto("/pricing")
  await expect(other.pins).toHaveCount(1)

  const second = `Second ${Date.now()}`
  await widget.comment(page.locator(".plan").nth(2).locator(".price"), second)
  await expect(other.pins).toHaveCount(2)

  // Reload: pins persist and re-anchor.
  await widget.reload()
  await expect(widget.pins).toHaveCount(2)

  // Author can edit their own comment; the other visitor can't.
  await widget.openThread(unique)
  await widget.thread.getByRole("button", { name: "Edit" }).click()
  await widget.thread
    .getByRole("textbox", { name: "Comment", exact: true })
    .fill(`${unique} (edited)`)
  await widget.thread.getByRole("button", { name: "Save" }).click()
  await expect(widget.thread).toContainText("(edited)")

  await other.openThread(`${unique} (edited)`)
  await expect(other.thread.getByRole("button", { name: "Edit" })).toHaveCount(
    0
  )
  await expect(
    other.thread.getByRole("button", { name: "Resolve" })
  ).toHaveCount(0)

  // SPA navigation swaps the page's comments; other pages are listed.
  await page.keyboard.press("Escape")
  await expect(widget.thread).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(widget.panel).toHaveCount(0)
  await page.getByRole("link", { name: "Tasks" }).click()
  await expect(page).toHaveURL(/\/tasks\?project=/)
  await expect(widget.pins).toHaveCount(0)
  await widget.openPanel()
  await expect(widget.panel).toContainText("/pricing")

  // Deleting own comment removes it for everyone.
  await page.keyboard.press("Escape")
  await page.getByRole("link", { name: "Pricing" }).click()
  await widget.openThread(second)
  await widget.deleteComment()
  await expect(other.pins).toHaveCount(1)
})

test("keyboard shortcut and escape", async ({ widget }) => {
  await widget.goto("/")
  await widget.openPanel()
  await expect(
    widget.panel.getByRole("button", { name: "Claim Nuni" })
  ).toBeVisible()
  await widget.panel.getByRole("button", { name: "Close" }).click()
  await widget.page.keyboard.press("c")
  await expect(widget.pickHint).toBeVisible()
  await widget.page.keyboard.press("Escape")
  await expect(widget.pickHint).toHaveCount(0)
})

test("clicks in comment mode don't trigger the page", async ({ widget }) => {
  await widget.goto("/")
  await widget.commentButton.click()
  await widget.page.getByRole("link", { name: "See pricing" }).click()
  await expect(widget.page).toHaveURL(/\/\?project=/)
  await expect(widget.composer).toBeVisible()
})

test("mobile: tap to place, bottom sheet composer", async ({ newVisitor }) => {
  const visitor = await newVisitor({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  await visitor.goto("/")
  await visitor.commentButton.tap()
  await visitor.page.locator(".feature").first().locator("h3").tap()
  await expect(visitor.composer).toBeVisible()
  await expect(visitor.composer).toHaveClass(/sheet/)
  const box = (await visitor.composer.boundingBox())!
  expect(Math.round(box.width)).toBe(390)
})
