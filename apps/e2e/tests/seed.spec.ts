import { expect, test } from "../fixtures"
import { dashboard } from "../helpers"

// Agent starting point: setup authenticates the owner through WorkOS Emulate.
test("authenticated seed", async ({ ownerPage }) => {
  await ownerPage.goto(dashboard())
  await expect(
    ownerPage.getByRole("heading", { name: "Projects", exact: true })
  ).toBeVisible()
})
