import { test, expect } from "../fixtures"

// Agent starting point: setup authenticates the owner through WorkOS Emulate.
test("authenticated seed", async ({ ownerPage }) => {
  await ownerPage.goto("http://localhost:3000/dashboard")
  await expect(
    ownerPage.getByRole("heading", { name: "Projects", exact: true })
  ).toBeVisible()
})
