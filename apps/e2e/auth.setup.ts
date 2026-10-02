import { mkdir } from "node:fs/promises"
import { test, expect } from "@playwright/test"
import { signIn } from "./helpers"
test("sign in both owners through WorkOS", async ({ browser }) => {
  await mkdir(".auth", { recursive: true })
  for (const [email, state] of [
    ["owner@nuni.test", "owner"],
    ["second-owner@nuni.test", "second-owner"],
  ]) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await signIn(page, email)
    await expect(
      page.getByRole("heading", { name: "Projects", exact: true })
    ).toBeVisible()
    await context.storageState({ path: `.auth/${state}.json` })
    await context.close()
  }
})
