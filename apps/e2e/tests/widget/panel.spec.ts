import { URLS } from "../../env"
import { expect, test } from "../../fixtures"
import type { Widget } from "../../widget"

const price = (widget: Widget, plan: number) =>
  widget.page.locator(".plan").nth(plan).locator(".price")

test("the panel marks the comment opened last and searches comments", async ({
  widget,
}) => {
  const stamp = Date.now()
  await widget.goto("/pricing")
  await widget.comment(price(widget, 0), `Make the logo bigger ${stamp}`, {
    name: "Sam Visitor",
  })
  await widget.comment(price(widget, 1), `Fix the price typo ${stamp}`)

  // The comment opened from the panel stays marked after its card closes.
  await widget.openPanel()
  await expect(widget.items).toHaveCount(2)
  await widget.item("price typo").click()
  await expect(widget.thread).toBeVisible()
  await widget.page.keyboard.press("Escape")
  const current = widget.list.locator('.item[aria-current="true"]')
  await expect(current).toHaveCount(1)
  await expect(current).toContainText("price typo")

  // And after a reload.
  await widget.reload()
  await widget.openPanel()
  await expect(current).toContainText("price typo")

  // Search filters by text and author; Escape clears it before closing.
  await widget.search.fill("LOGO")
  await expect(widget.items).toHaveCount(1)
  await expect(widget.items).toContainText("logo bigger")
  await widget.search.fill("nothing like this")
  await expect(widget.items).toHaveCount(0)
  await expect(widget.panel).toContainText(
    "No comments match “nothing like this”."
  )
  await widget.search.fill("sam visitor")
  await expect(widget.items).toHaveCount(2)
  await widget.page.keyboard.press("Escape")
  await expect(widget.search).toHaveValue("")
  await expect(widget.panel).toBeVisible()
  await widget.page.keyboard.press("Escape")
  await expect(widget.panel).toHaveCount(0)
})

test("Yours lists your comments on every page and opens them", async ({
  widget,
  newVisitor,
}) => {
  const stamp = Date.now()
  await widget.goto("/pricing")
  await widget.comment(price(widget, 0), `Pricing note ${stamp}`)
  await widget.goto("/")
  await widget.comment(widget.page.locator(".lead"), `Home note ${stamp}`)

  await widget.openPanel()
  const yours = widget.tab("Yours (2)")
  await yours.click()
  await expect(yours).toHaveAttribute("aria-selected", "true")
  await expect(widget.items).toHaveCount(2)
  await expect(widget.items.first()).toContainText("This page")
  await expect(widget.items.first()).toContainText("Open")
  await expect(widget.items.nth(1)).toContainText("/pricing")

  // A comment on another page opens there, focused.
  await widget.list.getByRole("link", { name: /Pricing note/ }).click()
  await expect(widget.page).toHaveURL(/\/pricing\?project=/)
  await expect(widget.thread).toContainText(`Pricing note ${stamp}`)

  // Someone else's browser has none of them.
  const stranger = await newVisitor()
  await stranger.goto("/pricing")
  await stranger.openPanel()
  await stranger.tab("Yours (0)").click()
  await expect(stranger.panel).toContainText(
    "Comments you leave on any page of this site show here."
  )
})

test("the panel lists every page's comments, this page first, and searches them all", async ({
  widget,
  newVisitor,
}) => {
  const stamp = Date.now()
  await widget.goto("/")
  await widget.comment(widget.page.locator(".lead"), `Home note ${stamp}`)
  await widget.goto("/pricing")
  await widget.comment(price(widget, 0), `Starter note ${stamp}`)
  await widget.comment(price(widget, 1), `Pro note ${stamp}`)

  await widget.openPanel()
  await expect(widget.tab("Open (3)")).toBeVisible()
  await expect(widget.sections).toHaveText(["This page", "/"])
  await expect(widget.items).toHaveCount(3)
  // Comments here open in place; the one on another page is a link there.
  await expect(widget.list.locator("button.item")).toHaveCount(2)
  const home = widget.list.getByRole("link", { name: /Home note/ })
  await expect(home).toBeVisible()

  // Search looks through every page.
  await widget.search.fill("home note")
  await expect(widget.items).toHaveCount(1)
  await expect(widget.sections).toHaveText(["/"])
  await widget.search.fill("note")
  await expect(widget.items).toHaveCount(3)
  // A page's path finds its comments, this page's too.
  await widget.search.fill("/pricing")
  await expect(widget.items).toHaveCount(2)
  await widget.search.fill("")

  // Opening it goes to that page, with the comment open.
  await home.click()
  await expect(widget.page).toHaveURL(
    new RegExp(`^${URLS.playground}/\\?project=`)
  )
  await expect(widget.thread).toContainText(`Home note ${stamp}`)
  await widget.openPanel()
  await expect(widget.sections).toHaveText(["This page", "/pricing"])
  await expect(
    widget.list.getByRole("link", { name: /Pro note/ })
  ).toBeVisible()

  // A new visitor on a page with no comments still sees, and searches, the
  // others.
  const visitor = await newVisitor()
  await visitor.goto("/tasks")
  await visitor.openPanel()
  await expect(visitor.sections).toHaveText(["This page", "/pricing", "/"])
  await expect(visitor.list).toContainText("No open comments on this page.")
  await visitor.search.fill("starter")
  await expect(visitor.items).toHaveCount(1)
  await expect(visitor.sections).toHaveText(["/pricing"])
})
