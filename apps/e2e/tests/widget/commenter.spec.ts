import { expect, test, type Page } from "@playwright/test"

import { generateProjectId } from "@nuni/shared"

import { dashboardURL, signIn } from "../../helpers"

const widget = (page: Page) => page.locator("#nuni-root")

/** Pick the first pricing plan and return the open composer. */
async function openComposer(page: Page) {
  await widget(page)
    .locator(".toolbar")
    .getByRole("button", { name: "Add a comment" })
    .click()
  await page
    .locator(".plan")
    .first()
    .getByRole("button", { name: "Choose plan" })
    .click()
  return widget(page).locator('[data-card="composer"]')
}

/** Sign in to comment through the dashboard popup, as the seeded commenter. */
async function signInToComment(page: Page, from: "composer" | "panel") {
  const popupPromise = page.waitForEvent("popup")
  const scope =
    from === "composer"
      ? widget(page).locator('[data-card="composer"]')
      : widget(page)
  await scope.getByRole("button", { name: "Sign in", exact: true }).click()
  const popup = await popupPromise
  await signIn(popup, "commenter@nuni.test")
  await expect(popup).toHaveURL(
    new RegExp(`${dashboardURL}/comment-sign-in\\?`)
  )
  await expect(
    popup.getByText("Comment on 127.0.0.1:5173 as Casey Commenter?")
  ).toBeVisible()
  await popup.getByRole("button", { name: "Continue" }).click()
  await expect(widget(page).locator(".toast")).toHaveText("You're signed in")
}

test("visitors can sign in to comment under their account, from any browser", async ({
  browser,
}) => {
  const projectId = generateProjectId()
  const laptop = await (await browser.newContext()).newPage()
  await laptop.goto(`/pricing?project=${projectId}`)

  // A guest comment first: signing in is optional.
  let composer = await openComposer(laptop)
  await composer.getByPlaceholder("Your name").fill("Val Visitor")
  await composer.getByPlaceholder("Leave a comment").fill("Guest first")
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(widget(laptop).locator(".toast")).toHaveText("Comment added")

  composer = await openComposer(laptop)
  await signInToComment(laptop, "composer")
  // The composer now writes under the account, with no name to type.
  await expect(composer.getByPlaceholder("Your name")).toHaveCount(0)
  await expect(composer.getByText("Casey Commenter")).toBeVisible()
  await expect(
    composer.getByRole("img", { name: "Signed in with GitHub" })
  ).toBeVisible()
  await composer.getByPlaceholder("Leave a comment").fill("Signed in now")
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(widget(laptop).locator(".toast")).toHaveText("Comment added")

  // The guest comment from this browser moved to the account too.
  await widget(laptop)
    .locator(".toolbar")
    .getByRole("button", { name: /open/ })
    .click()
  const panel = widget(laptop).locator(".panel")
  await panel.getByRole("tab", { name: /Yours/ }).click()
  await expect(panel.locator(".item")).toHaveCount(2)
  await panel.getByRole("tab", { name: /Open/ }).click()
  const items = panel.locator(".item")
  await expect(items).toHaveCount(2)
  for (const body of ["Guest first", "Signed in now"]) {
    const item = items.filter({ hasText: body })
    await expect(item.getByText("Casey Commenter")).toBeVisible()
    await expect(
      item.getByRole("img", { name: "Signed in with GitHub" })
    ).toBeVisible()
  }
  await expect(panel.getByText("Signed in as Casey Commenter")).toBeVisible()

  // Another browser: sign in again and the comments are still yours.
  const phone = await (await browser.newContext()).newPage()
  await phone.goto(`/pricing?project=${projectId}`)
  await openComposer(phone)
  await signInToComment(phone, "composer")
  await widget(phone)
    .locator('[data-card="composer"]')
    .getByRole("button", {
      name: "Cancel",
    })
    .click()
  await widget(phone)
    .locator(".toolbar")
    .getByRole("button", { name: /open/ })
    .click()
  const phonePanel = widget(phone).locator(".panel")
  await phonePanel.getByRole("tab", { name: /Yours/ }).click()
  await expect(phonePanel.locator(".item")).toHaveCount(2)
  await phonePanel.getByText("Guest first", { exact: true }).click()
  const thread = widget(phone).locator('[data-card="thread"]')
  await expect(thread.getByRole("button", { name: "Edit" })).toBeVisible()

  // Signing out goes back to commenting as a guest.
  await phonePanel.getByRole("button", { name: "Sign out" }).click()
  await expect(widget(phone).locator(".toast")).toHaveText("Signed out")
  await expect(phonePanel.getByText(/Signed in as/)).toHaveCount(0)
  await expect(thread.getByRole("button", { name: "Edit" })).toHaveCount(0)
  composer = await openComposer(phone)
  await expect(composer.getByPlaceholder("Your name")).toBeVisible()
  await expect(
    composer.getByRole("button", { name: "Sign in", exact: true })
  ).toBeVisible()

  await laptop.context().close()
  await phone.context().close()
})
