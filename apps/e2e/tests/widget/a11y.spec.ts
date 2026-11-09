import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"

import { expect, test } from "../../fixtures"

/** Serious or critical axe findings inside the widget. */
async function widgetViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  return results.violations
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes
        .filter((n) => JSON.stringify(n.target).includes("#nuni-root"))
        .map((n) => n.html),
    }))
    .filter(
      (v) =>
        v.nodes.length && (v.impact === "serious" || v.impact === "critical")
    )
}

test("keyboard only: pick, post, confirm, tabs and focus return", async ({
  widget,
  projectId,
}) => {
  const { page } = widget
  await widget.goto("/")

  // Start from a focused link: C, then Enter comments on it.
  await page.getByRole("link", { name: "See pricing" }).focus()
  await page.keyboard.press("c")
  await expect(widget.commentButton).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("ArrowDown")
  await expect(widget.highlightLabel).toContainText("See pricing")
  // Up to the actions row and back to the first link.
  await page.keyboard.press("ArrowUp")
  await expect(widget.highlightLabel).toContainText("div.hero-actions")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowRight")
  await expect(widget.highlightLabel).toContainText("Learn more")
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("Enter")
  await expect(widget.composer).toBeVisible()
  await widget.nameField.focus()
  await expect(widget.nameField).toBeFocused()
  await page.keyboard.type("Sam Tester")
  await page.keyboard.press("Tab")
  await page.keyboard.type("Keyboard comment")
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(widget.toast).toHaveText("Comment added")
  await expect(page).toHaveURL(new RegExp(`/\\?project=${projectId}$`))

  // The panel: focus moves to the selected tab, arrows switch tabs.
  await widget.panelButton.focus()
  await page.keyboard.press("Enter")
  const openTab = widget.tab(/Open/)
  await expect(openTab).toBeFocused()
  await page.keyboard.press("ArrowRight")
  const resolvedTab = widget.tab(/Resolved/)
  await expect(resolvedTab).toBeFocused()
  await expect(resolvedTab).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowLeft")
  await expect(openTab).toHaveAttribute("aria-selected", "true")

  // Open the comment from the list, then delete it: an in-widget dialog
  // asks first, and Escape keeps the comment.
  await page.keyboard.press("Tab")
  await page.keyboard.press("Enter")
  await expect(widget.thread).toContainText("Keyboard comment")
  await widget.thread.getByRole("button", { name: "Delete" }).click()
  await expect(widget.confirm).toContainText("Delete this comment?")
  const cancel = widget.confirm.getByRole("button", { name: "Cancel" })
  await expect(cancel).toBeFocused()
  // Tab stays inside the dialog.
  await page.keyboard.press("Tab")
  await expect(
    widget.confirm.getByRole("button", { name: "Delete" })
  ).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(cancel).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(widget.confirm).toHaveCount(0)
  await expect(widget.thread).toContainText("Keyboard comment")
  await expect(
    widget.thread.getByRole("button", { name: "Delete" })
  ).toBeFocused()

  // Closing the thread and the panel returns focus to the toolbar.
  await page.keyboard.press("Escape")
  await expect(widget.thread).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(widget.panel).toHaveCount(0)
  await expect(widget.panelButton).toBeFocused()
})

test("no serious accessibility issues in the widget", async ({ widget }) => {
  await widget.goto("/pricing")
  expect(await widgetViolations(widget.page)).toEqual([])

  // The composer, with a comment typed.
  await widget.startComment(
    widget.page.locator(".plan").first().locator(".price")
  )
  await widget.nameField.fill("Sam Tester")
  await widget.bodyField.fill("Check contrast")
  expect(await widgetViolations(widget.page)).toEqual([])
  await widget.post("Check contrast")

  // The panel and a thread.
  await widget.openThread("Check contrast")
  expect(await widgetViolations(widget.page)).toEqual([])
})
