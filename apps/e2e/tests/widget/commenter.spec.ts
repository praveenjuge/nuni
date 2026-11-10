import { DASHBOARD_ROUTES } from "@nuni/shared"

import { URLS, USERS } from "../../env"
import { expect, test } from "../../fixtures"
import { choosePlan, dashboard, signIn } from "../../helpers"
import type { Widget } from "../../widget"

const commenter = USERS.commenter.name

/** Sign in to comment through the dashboard popup, as the seeded commenter. */
async function signInToComment(widget: Widget) {
  const popupPromise = widget.page.waitForEvent("popup")
  await widget.composer
    .getByRole("button", { name: "Sign in", exact: true })
    .click()
  const popup = await popupPromise
  await signIn(popup, USERS.commenter)
  await expect(popup).toHaveURL(
    new RegExp(`^${dashboard(DASHBOARD_ROUTES.commentSignIn)}\\?`)
  )
  await expect(
    popup.getByText(
      `Comment on ${new URL(URLS.playground).host} as ${commenter}?`
    )
  ).toBeVisible()
  await popup.getByRole("button", { name: "Continue" }).click()
  await expect(widget.toast).toHaveText("You're signed in")
}

test("visitors can sign in to comment under their account, from any browser", async ({
  newVisitor,
}) => {
  const laptop = await newVisitor()
  await laptop.goto("/pricing")

  // A guest comment first: signing in is optional.
  await laptop.comment(choosePlan(laptop.page), "Guest first")

  await laptop.startComment(choosePlan(laptop.page))
  await signInToComment(laptop)
  // The composer now writes under the account, with no name to type.
  await expect(laptop.nameField).toHaveCount(0)
  await expect(laptop.composer.getByText(commenter)).toBeVisible()
  await expect(
    laptop.composer.getByRole("img", { name: "Signed in with GitHub" })
  ).toBeVisible()
  await laptop.post("Signed in now")

  // The guest comment from this browser moved to the account too.
  await laptop.openPanel()
  await laptop.tab(/Yours/).click()
  await expect(laptop.items).toHaveCount(2)
  await laptop.tab(/Open/).click()
  await expect(laptop.items).toHaveCount(2)
  for (const body of ["Guest first", "Signed in now"]) {
    const item = laptop.item(body)
    await expect(item.getByText(commenter)).toBeVisible()
    await expect(
      item.getByRole("img", { name: "Signed in with GitHub" })
    ).toBeVisible()
  }
  await expect(
    laptop.panel.getByText(`Signed in as ${commenter}`)
  ).toBeVisible()

  // Another browser: sign in again and the comments are still yours.
  const phone = await newVisitor()
  await phone.goto("/pricing")
  await phone.startComment(choosePlan(phone.page))
  await signInToComment(phone)
  await phone.composer.getByRole("button", { name: "Cancel" }).click()
  await phone.openPanel()
  await phone.tab(/Yours/).click()
  await expect(phone.items).toHaveCount(2)
  await phone.panel.getByText("Guest first", { exact: true }).click()
  await expect(phone.thread.getByRole("button", { name: "Edit" })).toBeVisible()

  // Signing out goes back to commenting as a guest.
  await phone.panel.getByRole("button", { name: "Sign out" }).click()
  await expect(phone.toast).toHaveText("Signed out")
  await expect(phone.panel.getByText(/Signed in as/)).toHaveCount(0)
  await expect(phone.thread.getByRole("button", { name: "Edit" })).toHaveCount(
    0
  )
  await phone.startComment(choosePlan(phone.page))
  await expect(phone.nameField).toBeVisible()
  await expect(
    phone.composer.getByRole("button", { name: "Sign in", exact: true })
  ).toBeVisible()
})
