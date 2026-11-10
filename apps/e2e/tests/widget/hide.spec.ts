import { COMMENT_PARAM } from "@nuni/shared"

import { expect, pageComments, test } from "../../fixtures"

test("Shift+C hides the pins, and they come back when needed", async ({
  widget,
  projectId,
}) => {
  const { page, pins, hideButton } = widget
  const body = `Hide me ${Date.now()}`
  await widget.goto("/pricing")
  await widget.comment(page.locator(".plan").nth(1).locator(".price"), body)
  await expect(pins).toHaveCount(1)
  await expect(pins).toBeVisible()
  await expect(hideButton).toHaveAttribute("aria-pressed", "false")
  await expect(hideButton).toHaveAttribute("title", "Hide comments (Shift+C)")

  // Shift+C hides them, and only them: the toolbar and its count stay.
  await page.keyboard.press("Shift+C")
  await expect(pins).toHaveCount(0)
  await expect(widget.toast).toHaveText(
    "Comments hidden. Press Shift+C to show them"
  )
  await expect(hideButton).toHaveAttribute("aria-pressed", "true")
  await widget.expectOpenCount(1)
  // It is not the comment hotkey: picking did not start.
  await expect(widget.commentButton).toHaveAttribute("aria-pressed", "false")

  // The choice is remembered for this visitor.
  await widget.reload()
  await expect(hideButton).toHaveAttribute("aria-pressed", "true")
  await expect(pins).toHaveCount(0)

  // Opening a comment from the panel shows just its pin.
  await widget.openThread(body)
  await expect(pins).toHaveCount(1)
  await expect(widget.activePin).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(widget.thread).toHaveCount(0)
  await expect(pins).toHaveCount(0)
  await page.keyboard.press("Escape")

  // So does a shared link to it.
  const [comment] = await pageComments(projectId, "/pricing")
  await widget.goto("/pricing", { [COMMENT_PARAM]: comment!._id })
  await expect(widget.thread).toContainText(body)
  await expect(widget.activePin).toBeVisible()
  await expect(pins).toHaveCount(1)
  await page.keyboard.press("Escape")
  await expect(pins).toHaveCount(0)

  // Starting a comment shows the others again.
  await page.keyboard.press("c")
  await expect(widget.commentButton).toHaveAttribute("aria-pressed", "true")
  await expect(pins).toHaveCount(1)
  await expect(hideButton).toHaveAttribute("aria-pressed", "false")
  await page.keyboard.press("Escape")

  // The toolbar button does the same as Shift+C.
  await hideButton.click()
  await expect(pins).toHaveCount(0)
  await hideButton.click()
  await expect(widget.toast).toHaveText("Comments shown")
  await expect(pins).toBeVisible()

  // Commenting on selected text shows them again too.
  await page.keyboard.press("Shift+C")
  await expect(pins).toHaveCount(0)
  await widget.selectWords(
    page.getByText("Unlimited projects"),
    "Unlimited projects"
  )
  await page.keyboard.press("c")
  await expect(widget.composer).toBeVisible()
  await expect(pins).toHaveCount(1)
  await expect(hideButton).toHaveAttribute("aria-pressed", "false")
})
