import type { Page } from "@playwright/test"

import { convexRun, expect, pageComments, test } from "../../fixtures"

/** The next pin report the widget sends, and how many pins it changed. */
function nextPinReport(page: Page) {
  return page
    .waitForResponse((r) => r.url().includes("/widget/pins"))
    .then((r) => r.json() as Promise<{ changed: number }>)
}

// A comment left on one tab (`?tab=team`) isn't on the page for visitors
// on another tab, so only visitors on its own tab can report it missing.
test("only visitors on the comment's query string report its pin missing", async ({
  widget,
  projectId,
}) => {
  const { page } = widget
  const heading = page.locator(".pricing h1")
  await widget.goto("/pricing", { tab: "team" })
  await widget.comment(heading, "Heading copy")
  // Nobody has found it for days.
  convexRun("testing:agePins", { publicId: projectId })

  await widget.goto("/pricing")
  let report = nextPinReport(page)
  await heading.evaluate((el) => el.remove())
  expect(await report).toEqual({ changed: 0 })
  expect((await pageComments(projectId, "/pricing"))[0]?.pinLost).toBe(false)

  await widget.goto("/pricing", { tab: "team" })
  report = nextPinReport(page)
  await heading.evaluate((el) => el.remove())
  expect(await report).toEqual({ changed: 1 })
  expect((await pageComments(projectId, "/pricing"))[0]?.pinLost).toBe(true)
})
