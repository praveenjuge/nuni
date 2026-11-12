import { DASHBOARD_ROUTES } from "@nuni/shared"

import { USERS } from "../../env"
import { convexRun, expect, test } from "../../fixtures"
import { addComment, claimProject, dashboard, projectPage } from "../../helpers"

interface Preview {
  to: string
  subject: string
  text: string
  unsubscribeUrl: string
}

/**
 * The email the owner would get now, or null when there is nothing to send.
 * Nothing is sent in the suite.
 */
const preview = (projectId: string) =>
  convexRun<Preview | undefined>("testing:previewDigest", {
    publicId: projectId,
  }) ?? null

test("the owner picks how often to be emailed, and can turn it off from the email", async ({
  widget,
  page,
  ownerPage,
  projectId,
}) => {
  await claimProject(ownerPage, projectId)
  const settings = `${projectPage(projectId)}/settings`
  await ownerPage.goto(settings)
  const frequency = ownerPage.getByRole("combobox", { name: "Email me" })
  await expect(frequency).toContainText("Daily")
  await expect(
    ownerPage.getByText(`Sent to ${USERS.owner.email}.`, { exact: false })
  ).toBeVisible()

  // Nothing has happened, so there is nothing to send.
  expect(preview(projectId)).toBeNull()

  await frequency.click()
  await ownerPage.getByRole("option", { name: "Weekly", exact: true }).click()
  await expect(frequency).toContainText("Weekly")
  await expect(
    ownerPage.getByText("Mondays at 08:00 UTC.", { exact: false })
  ).toBeVisible()

  const body = `Email review ${projectId}`
  await addComment(widget, body)
  const email = preview(projectId)
  expect(email).toMatchObject({ to: USERS.owner.email })
  expect(email!.subject).toContain("1 new comment")
  expect(email!.text).toContain(body)

  // The link in the email works signed out, and only once clicked.
  await page.goto(email!.unsubscribeUrl)
  await page.getByRole("button", { name: "Turn off emails" }).click()
  await expect(
    page.getByText("Emails are off for", { exact: false })
  ).toBeVisible()

  await ownerPage.goto(settings)
  await expect(
    ownerPage.getByRole("combobox", { name: "Email me" })
  ).toContainText("Off")
  await addComment(widget, `After turning off ${projectId}`)
  expect(preview(projectId)).toBeNull()
})

test("a broken unsubscribe link changes nothing", async ({ page }) => {
  await page.goto(
    dashboard(DASHBOARD_ROUTES.unsubscribe, { token: "nuni_u_missing" })
  )
  await expect(
    page.getByText("This link no longer works", { exact: true })
  ).toBeVisible()
})
