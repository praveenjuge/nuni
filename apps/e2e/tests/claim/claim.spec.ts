import { test, expect } from "../../fixtures"
import { addComment, dashboardURL } from "../../helpers"

test("widget popup claims with a real owner session and enables owner tools", async ({
  ownerPage,
  projectId,
}) => {
  await addComment(ownerPage, projectId, "Claim popup feedback")
  await ownerPage
    .locator("#nuni-root .toolbar")
    .getByRole("button", { name: /open/ })
    .click()
  const popupPromise = ownerPage.waitForEvent("popup")
  await ownerPage
    .locator("#nuni-root")
    .getByRole("button", { name: "Claim Nuni" })
    .click()
  const popup = await popupPromise
  await expect(popup).toHaveURL(new RegExp(`${dashboardURL}/claim\\?`))
  expect(new URL(popup.url()).searchParams.get("project")).toBe(projectId)
  await popup.getByRole("button", { name: "Claim and allow" }).click()
  await expect(ownerPage.locator("#nuni-root .toast")).toHaveText(
    "You're signed in as the owner"
  )
  await ownerPage
    .locator("#nuni-root .panel")
    .getByText("Claim popup feedback", { exact: true })
    .click()
  const thread = ownerPage.locator('#nuni-root [data-card="thread"]')
  await expect(
    thread.getByRole("button", { name: "Resolve", exact: true })
  ).toBeVisible()
  await thread.getByRole("button", { name: "Resolve", exact: true }).click()
  await expect(ownerPage.locator("#nuni-root .tb-count")).toHaveText("0")
})
