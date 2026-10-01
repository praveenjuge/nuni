import { expect, test } from "@playwright/test"

const DASHBOARD = "http://localhost:3000/dashboard"

test("settings and transfer pages render for signed-out visitors", async ({
  page,
}) => {
  await page.goto(`${DASHBOARD}/p/nuni_123456789ABCDEFGHJKLMN/settings`)
  await expect(
    page.getByRole("link", { name: /sign in/i }).first()
  ).toBeVisible()

  await page.goto(`${DASHBOARD}/transfer`)
  await expect(
    page.getByText("This transfer link is incomplete.", { exact: false })
  ).toBeVisible()

  // A real-looking link sends the visitor to sign in first, then back.
  const response = await page.request.get(
    `${DASHBOARD}/transfer?token=nuni_t_abc`,
    { maxRedirects: 0 }
  )
  expect(response.status()).toBeGreaterThanOrEqual(300)
  expect(response.status()).toBeLessThan(400)
  expect(decodeURIComponent(response.headers()["location"] ?? "")).toContain(
    "/dashboard/transfer?token=nuni_t_abc"
  )
})
