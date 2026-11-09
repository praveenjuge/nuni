import { COMMENT_PARAM } from "@nuni/shared"

import { expect, pageComments, test } from "../../fixtures"

for (const nested of [false, true]) {
  test(`comments jump to their exact pin in ${nested ? "a scroll container" : "the page"}`, async ({
    widget,
    projectId,
  }) => {
    const { page } = widget
    await page.addInitScript((nested) => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style")
        style.textContent =
          ".hero { height: 3000px; position: relative; }" +
          (nested ? "main { height: 600px; overflow: auto; }" : "")
        document.head.append(style)
      })
    }, nested)
    await widget.goto("/")
    const scrollTo = async (top: number) =>
      page.evaluate(
        ({ nested, top }) => {
          if (nested) document.querySelector("main")!.scrollTo(0, top)
          else window.scrollTo(0, top)
        },
        { nested, top }
      )
    await scrollTo(2400)
    await widget.commentButton.click()
    await page.mouse.click(400, 450)
    await expect(widget.composer).toBeVisible()
    await widget.post("Review this exact spot")
    await scrollTo(0)
    const expectPin = async () => {
      await expect(widget.thread).toContainText("Review this exact spot")
      await expect
        .poll(async () => {
          const box = await widget.activePin.boundingBox()
          return Boolean(box && box.y > 40 && box.y + box.height < 680)
        })
        .toBe(true)
    }
    await widget.openThread("Review this exact spot")
    await expectPin()

    // The dashboard's link to the comment opens it the same way on a fresh
    // page, and takes the comment off the address.
    const [comment] = await pageComments(projectId, "/")
    await widget.goto("/", { [COMMENT_PARAM]: comment!._id })
    await expectPin()
    await expect(page).not.toHaveURL(new RegExp(`${COMMENT_PARAM}=`))
  })
}
