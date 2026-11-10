import {
  DASHBOARD_ROUTES,
  TOKEN_PREFIX,
  handoffMessage,
  type HandoffMessage,
} from "@nuni/shared"

import { expect, test } from "../../fixtures"
import { addComment, dashboard } from "../../helpers"
import { Widget } from "../../widget"

test("widget popup claims with a real owner session and enables owner tools", async ({
  projectId,
  ownerPage,
}) => {
  const owner = new Widget(ownerPage, projectId)
  await addComment(owner, "Claim popup feedback")
  await owner.openPanel()

  // A session handed over by any page but the dashboard is ignored. The
  // widget's listener was added first, so it has run when this one does.
  await expect(owner.toast).toHaveCount(0)
  await owner.page.evaluate(
    (message: HandoffMessage) =>
      new Promise<void>((resolve) => {
        addEventListener("message", () => resolve(), { once: true })
        postMessage(message, "*")
      }),
    handoffMessage("session", projectId, `${TOKEN_PREFIX.session}forged`)
  )
  await expect(owner.toast).toHaveCount(0)

  const popupPromise = owner.page.waitForEvent("popup")
  await owner.panel.getByRole("button", { name: "Claim Nuni" }).click()
  const popup = await popupPromise
  await expect(popup).toHaveURL(
    new RegExp(`^${dashboard(DASHBOARD_ROUTES.claim)}\\?`)
  )
  expect(new URL(popup.url()).searchParams.get("project")).toBe(projectId)
  // The popup hands the session over and closes itself.
  const closed = popup.waitForEvent("close")
  await popup.getByRole("button", { name: "Claim and allow" }).click()
  await closed
  await expect(owner.toast).toHaveText("You're signed in as the owner")
  await owner.item("Claim popup feedback").click()
  await owner.thread
    .getByRole("button", { name: "Resolve", exact: true })
    .click()
  await owner.expectOpenCount(0)
})
