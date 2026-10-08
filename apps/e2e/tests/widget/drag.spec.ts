import { generateProjectId as projectId } from "@nuni/shared"
import { expect, test, type Page } from "@playwright/test"

const root = (page: Page) => page.locator("#nuni-root")
const toolbar = (page: Page) => root(page).locator(".toolbar")
const commentButton = (page: Page) =>
  toolbar(page).getByRole("button", { name: "Add a comment" })

/** Drag the toolbar by its comment button to a point on the screen. */
async function dragToolbarTo(page: Page, x: number, y: number) {
  const box = (await commentButton(page).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, y, { steps: 12 })
  await page.mouse.up()
}

/** The toolbar's gap to each edge of the viewport, once it has settled. */
async function edges(page: Page) {
  await expect
    .poll(() => toolbar(page).evaluate((el) => el.getAnimations().length))
    .toBe(0)
  // Measured in one step: the toolbar is redrawn with the rest of the UI.
  return toolbar(page).evaluate((el) => {
    const box = el.getBoundingClientRect()
    const view = document.documentElement
    return {
      left: box.left,
      top: box.top,
      right: view.clientWidth - box.right,
      bottom: view.clientHeight - box.bottom,
    }
  })
}

test("drag the toolbar and it snaps to a corner or edge middle", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  const project = projectId()
  await page.goto(`/?project=${project}`)
  await expect(toolbar(page)).toBeVisible()
  expect((await edges(page)).right).toBeLessThan(24)

  // Dropped near the top left, it settles in that corner.
  await dragToolbarTo(page, 180, 140)
  await expect(root(page)).toHaveAttribute("data-position", "top-left")
  let gaps = await edges(page)
  expect(gaps.left).toBeLessThan(24)
  expect(gaps.top).toBeLessThan(24)
  // The drag was not a press: picking did not start.
  await expect(commentButton(page)).toHaveAttribute("aria-pressed", "false")

  // Dropped in the middle third near the bottom, it centers itself.
  await dragToolbarTo(page, 640, 700)
  await expect(root(page)).toHaveAttribute("data-position", "bottom-center")
  gaps = await edges(page)
  expect(Math.abs(gaps.left - gaps.right)).toBeLessThan(2)
  expect(gaps.bottom).toBeLessThan(24)

  // The spot is remembered for this visitor.
  await page.reload()
  await expect(root(page)).toHaveAttribute("data-position", "bottom-center")

  // A plain click still works.
  await commentButton(page).click()
  await expect(
    toolbar(page).getByRole("button", { name: "Cancel adding a comment" })
  ).toHaveAttribute("aria-pressed", "true")
})

test("the position option accepts the edge middles", async ({ page }) => {
  const project = projectId()
  await page.goto(`/?project=${project}&position=top-center`)
  await expect(toolbar(page)).toBeVisible()
  await expect(root(page)).toHaveAttribute("data-position", "top-center")
  const gaps = await edges(page)
  expect(Math.abs(gaps.left - gaps.right)).toBeLessThan(2)
  expect(gaps.top).toBeLessThan(24)
})
