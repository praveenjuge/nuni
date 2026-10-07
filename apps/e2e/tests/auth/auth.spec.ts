import { test, expect } from "../../fixtures"
import { claimProject, dashboardURL, signIn } from "../../helpers"

test("sign in through AuthKit and sign out", async ({ page }) => {
  await page.goto(`${dashboardURL}/sign-in`)
  await signIn(page)
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Account" }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(
    page.getByRole("link", { name: "Sign in to Nuni" })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Account" })).toHaveCount(0)
})

test("claim redirects through sign-in and preserves returnTo", async ({
  page,
  projectId,
}) => {
  const target = `${dashboardURL}/claim?project=${projectId}&origin=${encodeURIComponent("http://127.0.0.1:5173")}`
  await page.goto(target)
  await expect(page).toHaveURL(/localhost:4100/)
  await signIn(page)
  await expect(page).toHaveURL(target)
  await expect(
    page.getByRole("button", { name: "Claim and allow" })
  ).toBeVisible()
})

test("signed user.created webhook creates a user before dashboard sign-in", async ({
  request,
  convexRun,
  projectId,
}) => {
  const response = await request.post(
    "http://localhost:4100/user_management/users",
    {
      headers: { Authorization: "Bearer sk_test_default" },
      data: {
        email: `webhook-${projectId}@nuni.test`,
        first_name: "Webhook",
        last_name: "Visitor",
        password: "nuni-local-password",
        email_verified: true,
      },
    }
  )
  expect(response.ok()).toBe(true)
  const user = (await response.json()) as { id: string }
  expect(user.id).toBeTruthy()
  await expect
    .poll(
      () =>
        convexRun<{ workosId: string } | null>("testing:authUser", {
          workosId: user.id,
        }),
      { timeout: 30_000 }
    )
    .toMatchObject({ workosId: user.id })
})

test("dashboard page loads keep the session the browser holds", async ({
  browser,
  playwright: { request },
  projectId,
}) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page)
  // Drop cookies set by AuthKit server actions, as when a reload or closed tab
  // cuts the response off. WorkOS refresh tokens are single-use, so a refresh
  // whose new cookie never lands would leave the browser with a dead one.
  // route.fetch() shares the page's cookie jar, so fetch through another one.
  const jar = await request.newContext()
  let pending = 0
  await page.route(`${dashboardURL}/**`, async (route) => {
    if (!route.request().headers()["next-action"]) return route.fallback()
    pending++
    try {
      const response = await jar.fetch(route.request())
      const headers = response.headers()
      delete headers["set-cookie"]
      await route.fulfill({ response, headers })
    } finally {
      pending--
    }
  })
  await claimProject(page, projectId)
  await expect.poll(() => pending).toBe(0)
  await page.goto(`${dashboardURL}/p/${projectId}/settings`)
  await expect(
    page.getByRole("textbox", { name: "Add a site origin" })
  ).toBeVisible()
  await jar.dispose()
  await context.close()
})
