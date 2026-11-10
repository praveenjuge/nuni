import type { Locator } from "@playwright/test"

import { expect, test } from "../../fixtures"

/** The pin's tip sits inside the element's box. */
async function expectPinOn(pin: Locator, target: Locator) {
  await expect(pin).toBeVisible()
  await expect
    .poll(async () => {
      const p = (await pin.boundingBox())!
      const t = (await target.boundingBox())!
      // The pin is drawn above-right of its tip (bottom-left corner).
      const tipX = p.x
      const tipY = p.y + p.height
      return (
        tipX >= t.x - 4 &&
        tipX <= t.x + t.width + 4 &&
        tipY >= t.y - 4 &&
        tipY <= t.y + t.height + 4
      )
    })
    .toBe(true)
}

test("pins inside a web component's shadow root and a same-origin iframe", async ({
  widget,
}) => {
  const { page, pins } = widget
  await widget.goto("/embeds")
  const frame = page.frameLocator('iframe[title="Approvals"]')
  await expect(frame.getByRole("heading", { name: "Approvals" })).toBeVisible()

  // Inside the second card's shadow root (Playwright locators pierce it).
  const plus = page
    .locator('acme-card[plan="Plus"]')
    .getByRole("button", { name: "Subscribe" })
  await widget.comment(plus, `Shadow pin ${Date.now()}`)
  await expectPinOn(pins.first(), plus)

  // Inside the iframe.
  const approve = frame.getByRole("button", { name: "Approve" }).nth(1)
  await widget.comment(approve, `Frame pin ${Date.now()}`)
  await expect(pins).toHaveCount(2)
  await expectPinOn(pins.nth(1), approve)

  // Both are found again after a reload, on the same elements.
  await widget.reload()
  await expect(frame.getByRole("heading", { name: "Approvals" })).toBeVisible()
  await expect(pins).toHaveCount(2)
  await expectPinOn(pins.first(), plus)
  await expectPinOn(pins.nth(1), approve)

  // The pin inside the iframe follows it when the page scrolls.
  await page.mouse.wheel(0, 120)
  await expectPinOn(pins.nth(1), approve)
})

test("pins follow re-rendered lists and say when they can't be found", async ({
  widget,
}) => {
  const { page, pins } = widget
  await widget.goto("/tasks")

  const task = page.locator(".task", { hasText: "Fix login bug" })
  await widget.comment(task, `Wrong order ${Date.now()}`)
  await expectPinOn(pins.first(), task)

  // The list re-renders in reverse: the pin moves with its item.
  await page.getByRole("button", { name: "Reverse" }).click()
  await expectPinOn(pins.first(), task)

  // A task that only exists until reload.
  await page.getByPlaceholder("New task").fill("Temporary task")
  await page.getByRole("button", { name: "Add", exact: true }).click()
  const temp = page.locator(".task", { hasText: "Temporary task" })
  const gone = `Gone after reload ${Date.now()}`
  await widget.comment(temp, gone)
  await widget.reload()
  await widget.openPanel()
  await expect(
    widget.panel.getByText("Couldn't find on this page")
  ).toBeVisible()
  await expect(widget.panel).toContainText(gone)
})
