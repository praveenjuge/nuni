import { expect, type Page } from "@playwright/test"
export const dashboardURL = "http://localhost:3000/dashboard"
export async function signIn(page: Page, email = "owner@nuni.test") {
  if (!page.url().startsWith("http://localhost:4100/"))
    await page.goto(`${dashboardURL}/sign-in`)
  await page.getByLabel("Email", { exact: false }).fill(email)
  await page.getByRole("button", { name: /continue|sign in/i }).click()
  await page
    .getByLabel("Password", { exact: false })
    .fill("nuni-local-password")
  await page.getByRole("button", { name: /continue|sign in/i }).click()
  await expect(page).toHaveURL(new RegExp("^" + dashboardURL))
}
export async function claimProject(page: Page, projectId: string) {
  await page.goto(
    `${dashboardURL}/claim?project=${projectId}&origin=${encodeURIComponent("http://127.0.0.1:5173")}`
  )
  await page.getByRole("button", { name: "Claim and allow" }).click()
  await expect(page.getByText("All set", { exact: false })).toBeVisible()
}
export async function addComment(page: Page, projectId: string, body: string) {
  await page.goto(`/pricing?project=${projectId}`)
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
  const name = composer.getByPlaceholder("Your name")
  if (await name.count()) await name.fill("Val Visitor")
  await composer.getByPlaceholder("Leave a comment").fill(body)
  await composer.getByRole("button", { name: "Post" }).click()
  await expect(page.locator("#nuni-root .toast")).toHaveText("Comment added")
}
