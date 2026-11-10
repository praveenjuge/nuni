import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import { DASHBOARD_ROUTES } from "@nuni/shared"

import { AUTH_STATE, USERS } from "./env"
import { expect, test } from "./fixtures"
import { dashboard, signIn } from "./helpers"

test("sign in both owners through WorkOS", async ({ browser }) => {
  for (const [user, state] of [
    [USERS.owner, AUTH_STATE.owner],
    [USERS.secondOwner, AUTH_STATE.secondOwner],
  ] as const) {
    await mkdir(dirname(state), { recursive: true })
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(dashboard(DASHBOARD_ROUTES.signIn))
    await signIn(page, user)
    await expect(
      page.getByRole("heading", { name: "Projects", exact: true })
    ).toBeVisible()
    await context.storageState({ path: state })
    await context.close()
  }
})
