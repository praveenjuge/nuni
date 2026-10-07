import { generateProjectId as projectId } from "@nuni/shared"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const root = (page: Page) => page.locator("#nuni-root")
const toolbar = (page: Page) => root(page).locator(".toolbar")

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
  page,
}) => {
  const project = projectId()
  await page.goto(`/?project=${project}`)
  await expect(toolbar(page)).toBeVisible()

  // Start from a focused link: C, then Enter comments on it.
  const link = page.getByRole("link", { name: "See pricing" })
  await link.focus()
  await page.keyboard.press("c")
  await expect(
    toolbar(page).getByRole("button", { name: "Cancel adding a comment" })
  ).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("ArrowDown")
  await expect(root(page).locator(".highlight-label")).toContainText(
    "See pricing"
  )
  // Up to the actions row and back to the first link.
  await page.keyboard.press("ArrowUp")
  await expect(root(page).locator(".highlight-label")).toContainText(
    "div.hero-actions"
  )
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowRight")
  await expect(root(page).locator(".highlight-label")).toContainText(
    "Learn more"
  )
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("Enter")
  const composer = root(page).locator('[data-card="composer"]')
  await expect(composer).toBeVisible()
  await composer.getByRole("textbox", { name: "Your name" }).focus()
  await expect(
    composer.getByRole("textbox", { name: "Your name" })
  ).toBeFocused()
  await page.keyboard.type("Sam Tester")
  await page.keyboard.press("Tab")
  await page.keyboard.type("Keyboard comment")
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(root(page).locator(".toast")).toHaveText("Comment added")
  await expect(page).toHaveURL(new RegExp(`/\\?project=${project}$`))

  // The panel: focus moves to the selected tab, arrows switch tabs.
  await toolbar(page).getByRole("button", { name: /open/ }).focus()
  await page.keyboard.press("Enter")
  const openTab = root(page).getByRole("tab", { name: /Open/ })
  await expect(openTab).toBeFocused()
  await page.keyboard.press("ArrowRight")
  const resolvedTab = root(page).getByRole("tab", { name: /Resolved/ })
  await expect(resolvedTab).toBeFocused()
  await expect(resolvedTab).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowLeft")
  await expect(openTab).toHaveAttribute("aria-selected", "true")

  // Open the comment from the list, then delete it: an in-widget dialog
  // asks first, and Escape keeps the comment.
  await page.keyboard.press("Tab")
  await page.keyboard.press("Enter")
  const thread = root(page).locator('[data-card="thread"]')
  await expect(thread).toContainText("Keyboard comment")
  await thread.getByRole("button", { name: "Delete" }).click()
  const dialog = root(page).getByRole("alertdialog")
  await expect(dialog).toContainText("Delete this comment?")
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused()
  // Tab stays inside the dialog.
  await page.keyboard.press("Tab")
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(thread).toContainText("Keyboard comment")
  await expect(thread.getByRole("button", { name: "Delete" })).toBeFocused()

  // Closing the thread and the panel returns focus to the toolbar.
  await page.keyboard.press("Escape")
  await expect(thread).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(root(page).locator(".panel")).toHaveCount(0)
  await expect(
    toolbar(page).getByRole("button", { name: /open/ })
  ).toBeFocused()
})

test("no serious accessibility issues in the widget", async ({ page }) => {
  const project = projectId()
  await page.goto(`/pricing?project=${project}`)
  await expect(toolbar(page)).toBeVisible()
  expect(await widgetViolations(page)).toEqual([])

  // The composer, with a comment posted.
  await toolbar(page).getByRole("button", { name: "Add a comment" }).click()
  await page.locator(".plan").first().locator(".price").click()
  const composer = root(page).locator('[data-card="composer"]')
  await composer.getByPlaceholder("Your name").fill("Sam Tester")
  await composer.getByPlaceholder("Leave a comment").fill("Check contrast")
  expect(await widgetViolations(page)).toEqual([])
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(root(page).locator(".toast")).toHaveText("Comment added")

  // The panel and a thread.
  await toolbar(page).getByRole("button", { name: /open/ }).click()
  await root(page).locator(".panel .item").first().click()
  await expect(root(page).locator('[data-card="thread"]')).toBeVisible()
  expect(await widgetViolations(page)).toEqual([])
})

test("position, color, theme, label, hotkey and locale options", async ({
  page,
}) => {
  const project = projectId()
  await page.goto(
    `/?project=${project}&position=top-left&accent=%23facc15&theme=dark&label=Feedback&hotkey=f&locale=de`
  )
  await expect(toolbar(page)).toBeVisible()
  // The toolbar re-renders, so measure it in one step.
  const box = await root(page).evaluate((host) => {
    const r = host
      .shadowRoot!.querySelector(".toolbar")!
      .getBoundingClientRect()
    return { x: r.x, y: r.y }
  })
  expect(box.x).toBeLessThan(40)
  expect(box.y).toBeLessThan(40)
  await expect(toolbar(page)).toContainText("Feedback")
  await expect(root(page)).toHaveAttribute("data-theme", "dark")
  const accent = await root(page).evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      accent: style.getPropertyValue("--n-accent").trim(),
      fg: style.getPropertyValue("--n-accent-fg").trim(),
      bg: style.getPropertyValue("--n-bg").trim(),
    }
  })
  expect(accent).toEqual({
    accent: "rgb(250, 204, 21)",
    fg: "#111111",
    bg: "#1d1b20",
  })

  // The hotkey is F now; C does nothing.
  const add = toolbar(page).locator('[data-focus-key="tb-comment"]')
  await page.keyboard.press("c")
  await expect(add).toHaveAttribute("aria-pressed", "false")
  await page.keyboard.press("f")
  await expect(add).toHaveAttribute("aria-pressed", "true")
  await expect(add).toHaveAttribute("title", "Add a comment (F)")
  await page.keyboard.press("Escape")
  await expect(add).toHaveAttribute("aria-pressed", "false")
})
