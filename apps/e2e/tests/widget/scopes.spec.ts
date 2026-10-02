import { generateProjectId as projectId } from "@nuni/shared"
import { expect, test, type Locator, type Page } from "@playwright/test"

const toolbar = (page: Page) => page.locator("#nuni-root .toolbar")
const pins = (page: Page) => page.locator("#nuni-root .pin:not(.pin-draft)")

async function comment(
  page: Page,
  target: Locator,
  body: string,
  name?: string
) {
  await toolbar(page).getByRole("button", { name: "Add a comment" }).click()
  await target.click()
  const composer = page.locator('#nuni-root [data-card="composer"]')
  await expect(composer).toBeVisible()
  // Capture redraws the composer. Fill after that redraw, using its visible preview.
  if (
    await target.evaluate((el) => el.ownerDocument.defaultView === window.top)
  ) {
    await expect(
      composer.getByRole("img", { name: "Screenshot that will be attached" })
    ).toBeVisible()
  }
  if (name) await composer.getByPlaceholder("Your name").fill(name)
  await composer.getByPlaceholder("Leave a comment").fill(body)
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(page.locator("#nuni-root .toast")).toHaveText("Comment added")
}

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
  page,
}) => {
  const project = projectId()
  await page.goto(`/embeds?project=${project}`)
  await expect(toolbar(page)).toBeVisible()
  const frame = page.frameLocator('iframe[title="Approvals"]')
  await expect(frame.getByRole("heading", { name: "Approvals" })).toBeVisible()

  // Inside the second card's shadow root (Playwright locators pierce it).
  const plus = page
    .locator('acme-card[plan="Plus"]')
    .getByRole("button", { name: "Subscribe" })
  await comment(page, plus, `Shadow pin ${Date.now()}`, "Sam Tester")
  await expectPinOn(pins(page).first(), plus)

  // Inside the iframe.
  const approve = frame.getByRole("button", { name: "Approve" }).nth(1)
  await comment(page, approve, `Frame pin ${Date.now()}`)
  await expect(pins(page)).toHaveCount(2)
  await expectPinOn(pins(page).nth(1), approve)

  // Both are found again after a reload, on the same elements.
  await page.reload()
  await expect(frame.getByRole("heading", { name: "Approvals" })).toBeVisible()
  await expect(pins(page)).toHaveCount(2)
  await expectPinOn(pins(page).first(), plus)
  await expectPinOn(pins(page).nth(1), approve)

  // The pin inside the iframe follows it when the page scrolls.
  await page.mouse.wheel(0, 120)
  await expectPinOn(pins(page).nth(1), approve)
})

test("pins follow re-rendered lists and say when they can't be found", async ({
  page,
}) => {
  const project = projectId()
  await page.goto(`/tasks?project=${project}`)
  await expect(toolbar(page)).toBeVisible()

  const task = page.locator(".task", { hasText: "Fix login bug" })
  await comment(page, task, `Wrong order ${Date.now()}`, "Sam Tester")
  await expectPinOn(pins(page).first(), task)

  // The list re-renders in reverse: the pin moves with its item.
  await page.getByRole("button", { name: "Reverse" }).click()
  await expectPinOn(pins(page).first(), task)

  // A task that only exists until reload.
  await page.getByPlaceholder("New task").fill("Temporary task")
  await page.getByRole("button", { name: "Add", exact: true }).click()
  const temp = page.locator(".task", { hasText: "Temporary task" })
  const gone = `Gone after reload ${Date.now()}`
  await comment(page, temp, gone)
  await page.reload()
  await expect(toolbar(page)).toBeVisible()
  await toolbar(page).getByRole("button", { name: /open/ }).click()
  const panel = page.locator("#nuni-root .panel")
  await expect(panel.getByText("Couldn't find on this page")).toBeVisible()
  await expect(panel).toContainText(gone)
})
