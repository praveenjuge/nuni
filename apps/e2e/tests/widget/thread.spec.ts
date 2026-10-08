import { convexRun } from "../../fixtures"
import { generateProjectId as projectId } from "@nuni/shared"

import { expect, test, type Page } from "@playwright/test"

/** Seed widget credentials for legacy thread regressions; product flows use real sign-in. */
function seedOwner(publicId: string): string {
  return convexRun<{ token: string }>("testing:seedOwner", {
    publicId,
    origin: "http://127.0.0.1:5173",
    name: "Olive Owner",
  }).token
}

const thread = (page: Page) => page.locator('#nuni-root [data-card="thread"]')

/** Open a comment from the widget panel and verify its body before interacting. */
async function openThread(page: Page, body: string) {
  await page
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: /open/ })
    .click()
  await page.locator("#nuni-root .panel").getByText(body).click()
  await expect(thread(page)).toContainText(body)
}

/** Submit a reply through the visible thread form, optionally setting a visitor name. */
async function sendReply(page: Page, body: string, name?: string) {
  const form = thread(page).locator(".reply-form")
  if (name) await form.getByPlaceholder("Your name").fill(name)
  await form.getByRole("textbox", { name: "Reply" }).fill(body)
  await form.getByRole("button", { name: "Send reply" }).click()
}

test("replies and reactions sync live, with an Owner badge", async ({
  page,
  browser,
}) => {
  const project = projectId()
  const token = seedOwner(project)
  const body = `Can this be blue? ${Date.now()}`

  await page.goto(`/pricing?project=${project}`)
  await page
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: "Add a comment" })
    .click()
  await page.locator(".plan").first().locator(".price").click()
  const composer = page.locator('#nuni-root [data-card="composer"]')
  await composer.getByPlaceholder("Your name").fill("Sam Visitor")
  await composer.getByPlaceholder("Leave a comment").fill(body)
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(page.locator("#nuni-root .toast")).toHaveText("Comment added")

  // A second visitor follows the same thread.
  const otherContext = await browser.newContext()
  const other = await otherContext.newPage()
  await other.goto(`/pricing?project=${project}`)
  await openThread(other, body)

  await openThread(page, body)
  await sendReply(page, "Also the border")
  const replies = (p: Page) => thread(p).locator(".reply")
  await expect(replies(page)).toHaveCount(1)
  await expect(replies(other)).toHaveCount(1)
  await expect(replies(other)).toContainText("Sam Visitor")
  await expect(replies(other)).toContainText("Also the border")
  // The visitor can delete their own reply; the other visitor can't.
  await expect(
    replies(page).getByRole("button", { name: "Delete reply" })
  ).toHaveCount(1)
  await expect(
    replies(other).getByRole("button", { name: "Delete reply" })
  ).toHaveCount(0)

  // Reactions on the comment: one each, counted live.
  const commentReactions = (p: Page) =>
    thread(p).locator(".card-body .reactions").first()
  await commentReactions(page)
    .getByRole("button", { name: "Add a reaction" })
    .click()
  await commentReactions(page)
    .getByRole("button", { name: "React with 👍" })
    .click()
  await expect(
    commentReactions(other).getByRole("button", { name: /👍 1/ })
  ).toBeVisible()
  await commentReactions(other).getByRole("button", { name: /👍 1/ }).click()
  await expect(
    commentReactions(page).getByRole("button", { name: /👍 2/ })
  ).toHaveAttribute("aria-pressed", "true")
  // Clicking your own reaction again takes it back.
  await commentReactions(page).getByRole("button", { name: /👍 2/ }).click()
  await expect(
    commentReactions(other).getByRole("button", { name: /👍 1/ })
  ).toHaveAttribute("aria-pressed", "true")

  // The owner replies from the widget with a badge.
  const ownerContext = await browser.newContext()
  await ownerContext.addInitScript(
    ([key, value]) => localStorage.setItem(key!, value!),
    [`nuni:session:${project}`, token]
  )
  const owner = await ownerContext.newPage()
  await owner.goto(`/pricing?project=${project}`)
  await openThread(owner, body)
  await sendReply(owner, "Done, it's blue now")
  await expect(replies(page)).toHaveCount(2)
  const ownerReply = replies(page).nth(1)
  await expect(ownerReply).toContainText("Olive Owner")
  await expect(ownerReply.locator(".badge-owner")).toHaveText("Owner")

  // The panel shows the reply count.
  await page.keyboard.press("Escape")
  await expect(
    page.locator("#nuni-root .panel .item").filter({ hasText: body })
  ).toContainText("2 replies")

  await otherContext.close()
  await ownerContext.close()
})

test("pressing the page closes the card unless it has unsent words", async ({
  page,
}) => {
  const project = projectId()
  const body = `Close me like Figma ${Date.now()}`
  await page.goto(`/pricing?project=${project}`)
  const elsewhere = page.locator(".plan").nth(2).locator(".price")

  // An empty composer closes; one with words stays open.
  await page
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: "Add a comment" })
    .click()
  await page.locator(".plan").first().locator(".price").click()
  const composer = page.locator('#nuni-root [data-card="composer"]')
  await expect(composer).toBeVisible()
  await elsewhere.click()
  await expect(composer).toHaveCount(0)

  await page
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: "Add a comment" })
    .click()
  await page.locator(".plan").first().locator(".price").click()
  await composer.getByPlaceholder("Your name").fill("Sam Visitor")
  await composer.getByPlaceholder("Leave a comment").fill(body)
  await elsewhere.click()
  await expect(composer).toBeVisible()
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(page.locator("#nuni-root .toast")).toHaveText("Comment added")

  // The thread closes on a press outside it, but not while a reply is typed.
  await page.locator("#nuni-root .pin:not(.pin-draft)").click()
  await expect(thread(page)).toContainText(body)
  await elsewhere.click()
  await expect(thread(page)).toHaveCount(0)

  await page.locator("#nuni-root .pin:not(.pin-draft)").click()
  const reply = thread(page).getByRole("textbox", { name: "Reply" })
  await reply.fill("Half a thought")
  await elsewhere.click()
  await expect(thread(page)).toBeVisible()
  await reply.fill("")
  await elsewhere.click()
  await expect(thread(page)).toHaveCount(0)
})
