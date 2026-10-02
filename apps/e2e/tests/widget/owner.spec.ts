import { convexRun } from "../../fixtures"
import { generateProjectId as projectId } from "@nuni/shared"

import { expect, test, type Page } from "@playwright/test"

const APP_URL = process.env.VITE_APP_URL ?? "http://localhost:3000"

function seedOwner(publicId: string): string {
  return convexRun<{ token: string }>("testing:seedOwner", {
    publicId,
    origin: "http://127.0.0.1:5173",
    name: "Olive Owner",
  }).token
}

const openPanel = (page: Page) =>
  page
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: /open/ })
    .click()

async function postComment(page: Page, body: string) {
  await page
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: "Add a comment" })
    .click()
  await page
    .locator(".plan")
    .first()
    .getByRole("button", { name: "Choose plan" })
    .click()
  const composer = page.locator('#nuni-root [data-card="composer"]')
  const nameInput = composer.getByPlaceholder("Your name")
  if (await nameInput.count()) await nameInput.fill("Val Visitor")
  await composer.getByPlaceholder("Leave a comment").fill(body)
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(page.locator("#nuni-root .toast")).toHaveText("Comment added")
}

test("owner resolves and deletes from the widget; visitors see it live", async ({
  browser,
}) => {
  const project = projectId()
  const token = seedOwner(project)

  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto(`/pricing?project=${project}`)
  await postComment(visitor, "Typo in the plan name")
  await expect(visitor.locator("#nuni-root .tb-count")).toHaveText("1")

  const ownerContext = await browser.newContext()
  await ownerContext.addInitScript(
    ([key, value]) => localStorage.setItem(key!, value!),
    [`nuni:session:${project}`, token]
  )
  const owner = await ownerContext.newPage()
  await owner.goto(`/pricing?project=${project}`)
  await openPanel(owner)
  await expect(owner.locator("#nuni-root .panel-foot")).toHaveCount(0)
  await expect(
    owner.locator("#nuni-root .panel input[type=checkbox]")
  ).toHaveCount(0)

  await owner
    .locator("#nuni-root .panel")
    .getByText("Typo in the plan name")
    .click()
  const thread = owner.locator('#nuni-root [data-card="thread"]')
  // Owner can resolve and delete, but not edit someone else's words.
  await expect(thread.getByRole("button", { name: "Edit" })).toHaveCount(0)
  await thread.getByRole("button", { name: "Resolve" }).click()
  await expect(owner.locator("#nuni-root .toast")).toHaveText("Resolved")
  await expect(visitor.locator("#nuni-root .tb-count")).toHaveText("0")
  await expect(visitor.locator("#nuni-root .pin:not(.pin-draft)")).toHaveCount(
    0
  )

  await postComment(visitor, "Second open comment")
  await expect(visitor.locator("#nuni-root .tb-count")).toHaveText("1")

  // Reopen from the Resolved tab, then delete.
  await owner
    .locator("#nuni-root .panel")
    .getByRole("tab", { name: /Resolved/ })
    .click()
  await expect(
    owner.locator("#nuni-root .pin[data-status=resolved]")
  ).toHaveCount(1)
  await expect(owner.locator("#nuni-root .pin[data-status=open]")).toHaveCount(
    0
  )
  await owner
    .locator("#nuni-root .panel")
    .getByRole("tab", { name: /Open/ })
    .click()
  await expect(
    owner.locator("#nuni-root .pin[data-status=resolved]")
  ).toHaveCount(0)
  await expect(owner.locator("#nuni-root .pin[data-status=open]")).toHaveCount(
    1
  )
  await owner
    .locator("#nuni-root .panel")
    .getByRole("tab", { name: /Resolved/ })
    .click()
  await owner
    .locator("#nuni-root .panel")
    .getByText("Typo in the plan name")
    .click()
  await owner
    .locator('#nuni-root [data-card="thread"]')
    .getByRole("button", { name: "Reopen" })
    .click()
  await expect(visitor.locator("#nuni-root .tb-count")).toHaveText("2")
  await owner
    .locator('#nuni-root [data-card="thread"]')
    .getByRole("button", { name: "Delete" })
    .click()
  await owner
    .locator("#nuni-root")
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete" })
    .click()
  await expect(visitor.locator("#nuni-root .tb-count")).toHaveText("1")

  await expect(owner.locator("#nuni-root .panel-foot")).toHaveCount(0)
})

test("claim popup hands the owner session to the widget", async ({
  page,
  context,
}) => {
  const project = projectId()
  const token = seedOwner(project)
  await page.goto(`/pricing?project=${project}`)
  await openPanel(page)
  await expect(page.locator("#nuni-root .panel-foot")).toHaveCount(0)

  // A message from any other origin is ignored.
  await page.evaluate(
    ([project, token]) =>
      window.postMessage({ type: "nuni:session", project, token }, "*"),
    [project, token]
  )
  await page.waitForTimeout(300)
  await expect(page.locator("#nuni-root .panel-foot")).toHaveCount(0)

  // The dashboard popup (app origin) posts the token back to its opener.
  const popupPromise = context.waitForEvent("page")
  await page.evaluate(
    (url) => window.open(url, "nuni-claim"),
    `${APP_URL}/dashboard/claim`
  )
  const popup = await popupPromise
  await popup.waitForLoadState()
  await popup.evaluate(
    ([project, token]) =>
      window.opener.postMessage(
        { type: "nuni:session", project, token },
        "http://127.0.0.1:5173"
      ),
    [project, token]
  )
  await expect(page.locator("#nuni-root .toast")).toHaveText(
    "You're signed in as the owner"
  )
  await expect(page.locator("#nuni-root .panel-foot")).toHaveCount(0)
})

test("deep link opens the comment", async ({ page, browser }) => {
  const project = projectId()
  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto(`/pricing?project=${project}`)
  await postComment(visitor, "Deep linked comment")
  await visitor
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: /open/ })
    .click()
  await visitor
    .locator("#nuni-root .panel")
    .getByText("Deep linked comment")
    .click()
  const id = await visitor.evaluate(() => {
    const root = document.getElementById("nuni-root")!.shadowRoot!
    return root
      .querySelector(".pin[data-active='true']")
      ?.getAttribute("aria-label")
  })
  expect(id).toContain("Deep linked comment")

  // Find the comment id through the public query and open the jump URL.
  const commentId = await visitor.evaluate(async (project) => {
    const res = await fetch("http://127.0.0.1:3210/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "comments:listForPage",
        args: { publicId: project, path: "/pricing" },
        format: "json",
      }),
    })
    const data = (await res.json()) as { value: { _id: string }[] }
    return data.value[0]!._id
  }, project)

  await page.goto(`/pricing?project=${project}&nuni=${commentId}`)
  await expect(page.locator('#nuni-root [data-card="thread"]')).toContainText(
    "Deep linked comment"
  )
  await expect(page).not.toHaveURL(/nuni=/)
})
