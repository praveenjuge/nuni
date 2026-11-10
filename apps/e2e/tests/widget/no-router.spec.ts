import { COMMENT_PARAM } from "@nuni/shared"

import { expect, pageComments, test } from "../../fixtures"

// A React app with no router whose content keeps re-rendering (a ticking
// counter). Clicking a comment in the panel must still jump to its pin.
test("comments in the panel open on a page without a router", async ({
  widget,
  projectId,
}) => {
  const { page } = widget
  const body = "Check the support copy"
  await widget.goto("/no-router.html")
  await widget.comment(page.getByRole("heading", { name: "Support" }), body)
  const pinInView = () =>
    expect
      .poll(async () => {
        const box = await widget.activePin.boundingBox()
        const height = page.viewportSize()!.height
        return Boolean(box && box.y > 0 && box.y + box.height < height)
      })
      .toBe(true)

  // A held press, like a person's: the page re-renders while it is down.
  await widget.openPanel()
  await page.evaluate(() => window.scrollTo(0, 0))
  const counter = page.locator(".lead")
  await widget.item(body).hover()
  const shown = await counter.textContent()
  await page.mouse.down()
  await expect(counter).not.toHaveText(shown!)
  await page.mouse.up()
  await expect(widget.thread).toContainText(body)
  await pinInView()

  // The dashboard's link to the comment opens it on this page too.
  const [comment] = await pageComments(projectId, "/no-router.html")
  await widget.goto("/no-router.html", { [COMMENT_PARAM]: comment!._id })
  await expect(widget.thread).toContainText(body)
  await pinInView()
})
