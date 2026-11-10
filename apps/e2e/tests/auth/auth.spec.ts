import { DASHBOARD_ROUTES, TOKEN_PREFIX, dashboardPath } from "@nuni/shared"

import { DASHBOARD_URL, URLS, USERS, WORKOS } from "../../env"
import { convexRun, expect, test } from "../../fixtures"
import { claimProject, dashboard, projectPage, signIn } from "../../helpers"

test("sign in through AuthKit and sign out", async ({ page }) => {
  await page.goto(dashboard(DASHBOARD_ROUTES.signIn))
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
  const target = dashboard(DASHBOARD_ROUTES.claim, {
    project: projectId,
    origin: URLS.playground,
  })
  await page.goto(target)
  await signIn(page)
  await expect(page).toHaveURL(target)
  await expect(
    page.getByRole("button", { name: "Claim and allow" })
  ).toBeVisible()
})

test("settings and transfer pages ask signed-out visitors to sign in", async ({
  page,
  projectId,
}) => {
  await page.goto(`${projectPage(projectId)}/settings`)
  await expect(
    page.getByRole("link", { name: /sign in/i }).first()
  ).toBeVisible()

  await page.goto(dashboard(DASHBOARD_ROUTES.transfer))
  await expect(
    page.getByText("This transfer link is incomplete.", { exact: false })
  ).toBeVisible()

  // A real-looking link sends the visitor to sign in first, then back.
  const token = `${TOKEN_PREFIX.transfer}abc`
  const response = await page.request.get(
    dashboard(DASHBOARD_ROUTES.transfer, { token }),
    { maxRedirects: 0 }
  )
  expect(response.status()).toBeGreaterThanOrEqual(300)
  expect(response.status()).toBeLessThan(400)
  expect(decodeURIComponent(response.headers()["location"] ?? "")).toContain(
    dashboardPath(DASHBOARD_ROUTES.transfer, { token })
  )
})

test("signed user.created webhook creates a user before dashboard sign-in", async ({
  request,
  projectId,
}) => {
  const response = await request.post(`${URLS.workos}/user_management/users`, {
    headers: { Authorization: `Bearer ${WORKOS.apiKey}` },
    data: {
      email: `webhook-${projectId}@nuni.test`,
      first_name: "Webhook",
      last_name: "Visitor",
      password: USERS.owner.password,
      email_verified: true,
    },
  })
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
  await page.goto(dashboard(DASHBOARD_ROUTES.signIn))
  await signIn(page)
  // Drop cookies set by AuthKit server actions, as when a reload or closed tab
  // cuts the response off. WorkOS refresh tokens are single-use, so a refresh
  // whose new cookie never lands would leave the browser with a dead one.
  // route.fetch() shares the page's cookie jar, so fetch through another one.
  const jar = await request.newContext()
  let pending = 0
  await page.route(`${DASHBOARD_URL}/**`, async (route) => {
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
  await page.goto(`${projectPage(projectId)}/settings`)
  await expect(
    page.getByRole("textbox", { name: "Add a site origin" })
  ).toBeVisible()
  await jar.dispose()
  await context.close()
})
