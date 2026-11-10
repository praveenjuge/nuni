import { expect, test } from "../../fixtures"
import type { Widget } from "../../widget"

/** Drag the toolbar by its comment button to a point on the screen. */
async function dragToolbarTo(widget: Widget, x: number, y: number) {
  const box = (await widget.commentButton.boundingBox())!
  const { mouse } = widget.page
  await mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await mouse.down()
  await mouse.move(x, y, { steps: 12 })
  await mouse.up()
}

/** The toolbar's gap to each edge of the viewport, once it has settled. */
async function edges(widget: Widget) {
  await expect
    .poll(() => widget.toolbar.evaluate((el) => el.getAnimations().length))
    .toBe(0)
  const box = await widget.toolbarBox()
  const view = await widget.page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }))
  return {
    left: box.x,
    top: box.y,
    right: view.width - (box.x + box.width),
    bottom: view.height - (box.y + box.height),
  }
}

test("drag the toolbar and it snaps to a corner or edge middle", async ({
  widget,
}) => {
  await widget.page.setViewportSize({ width: 1200, height: 800 })
  await widget.goto("/")
  expect((await edges(widget)).right).toBeLessThan(24)

  // Dropped near the top left, it settles in that corner.
  await dragToolbarTo(widget, 180, 140)
  await expect(widget.root).toHaveAttribute("data-position", "top-left")
  let gaps = await edges(widget)
  expect(gaps.left).toBeLessThan(24)
  expect(gaps.top).toBeLessThan(24)
  // The drag was not a press: picking did not start.
  await expect(widget.commentButton).toHaveAttribute("aria-pressed", "false")

  // Dropped in the middle third near the bottom, it centers itself.
  await dragToolbarTo(widget, 640, 700)
  await expect(widget.root).toHaveAttribute("data-position", "bottom-center")
  gaps = await edges(widget)
  expect(Math.abs(gaps.left - gaps.right)).toBeLessThan(2)
  expect(gaps.bottom).toBeLessThan(24)

  // The spot is remembered for this visitor.
  await widget.reload()
  await expect(widget.root).toHaveAttribute("data-position", "bottom-center")

  // A plain click still works.
  await widget.commentButton.click()
  await expect(widget.commentButton).toHaveAttribute("aria-pressed", "true")
})

test("the position option accepts the edge middles", async ({ widget }) => {
  await widget.goto("/", { position: "top-center" })
  await expect(widget.root).toHaveAttribute("data-position", "top-center")
  const gaps = await edges(widget)
  expect(Math.abs(gaps.left - gaps.right)).toBeLessThan(2)
  expect(gaps.top).toBeLessThan(24)
})
