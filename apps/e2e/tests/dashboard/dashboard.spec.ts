import { test, expect } from "../../fixtures"
import { addComment, claimProject, dashboardURL } from "../../helpers"

test("claimed projects and widget comments appear and resolve live", async ({
  page,
  ownerPage,
  projectId,
}) => {
  const body = `Dashboard review ${projectId}`
  await addComment(page, projectId, body)
  await claimProject(ownerPage, projectId)
  await ownerPage.goto(dashboardURL)
  const project = ownerPage.locator(`a[href='/dashboard/p/${projectId}']`)
  await expect(project).toContainText("1 open")
  await expect(project).toContainText("1 total")
  await project.click()
  const comment = ownerPage.getByRole("listitem").filter({ hasText: body })
  await expect(comment).toBeVisible()
  await comment.getByRole("button", { name: "Resolve", exact: true }).click()
  await expect(
    ownerPage.getByRole("tab", { name: "Open (0)", exact: true })
  ).toBeVisible()
  await expect(page.locator("#nuni-root .tb-count")).toHaveText("0")
  await ownerPage
    .getByRole("tab", { name: "Resolved (1)", exact: true })
    .click()
  await comment.getByRole("button", { name: "Reopen", exact: true }).click()
  await expect(page.locator("#nuni-root .tb-count")).toHaveText("1")
  await ownerPage.getByRole("tab", { name: "Open (1)", exact: true }).click()
  await expect(comment).toBeVisible()
})

test("rename, allow another origin, and delete a project", async ({
  ownerPage,
  projectId,
}) => {
  await claimProject(ownerPage, projectId)
  await ownerPage.goto(`${dashboardURL}/p/${projectId}`)
  await ownerPage
    .getByRole("textbox", { name: "Add a site origin" })
    .fill("https://staging.example.com")
  await ownerPage.getByRole("button", { name: "Add site", exact: true }).click()
  await expect(
    ownerPage.getByText("staging.example.com", { exact: true })
  ).toBeVisible()
  await ownerPage.reload()
  await expect(
    ownerPage.getByText("staging.example.com", { exact: true })
  ).toBeVisible()
  await ownerPage.getByRole("link", { name: "Settings", exact: true }).click()
  const name = `Review ${projectId}`
  await ownerPage.getByRole("textbox", { name: "Project name" }).fill(name)
  await ownerPage.getByRole("button", { name: "Save", exact: true }).click()
  await expect(
    ownerPage.getByRole("button", { name: "Saved", exact: true })
  ).toBeVisible()
  await ownerPage.reload()
  await expect(
    ownerPage.getByRole("textbox", { name: "Project name" })
  ).toHaveValue(name)
  await expect(
    ownerPage.getByRole("button", { name: "Delete project" })
  ).toBeDisabled()
  await ownerPage.getByLabel(`Type ${name} to confirm`).fill(name)
  await ownerPage.getByRole("button", { name: "Delete project" }).click()
  await expect(ownerPage).toHaveURL(dashboardURL)
  await expect(
    ownerPage.locator(`a[href='/dashboard/p/${projectId}']`)
  ).toHaveCount(0)
  await ownerPage.goto(`${dashboardURL}/p/${projectId}`)
  await expect(
    ownerPage.getByText("Project not found", { exact: true })
  ).toBeVisible()
})

test("owner transfers a project once and loses access", async ({
  browser,
  page,
  ownerPage,
  projectId,
}) => {
  const body = `Transferred feedback ${projectId}`
  await addComment(page, projectId, body)
  await claimProject(ownerPage, projectId)
  await ownerPage.goto(`${dashboardURL}/p/${projectId}/settings`)
  await ownerPage
    .getByRole("button", { name: "Make a link", exact: true })
    .click()
  const link = ownerPage
    .locator("code")
    .filter({ hasText: "/dashboard/transfer?token=" })
  await expect(link).toBeVisible()
  const url = (await link.textContent())!
  const context = await browser.newContext({
    storageState: ".auth/second-owner.json",
  })
  try {
    const recipient = await context.newPage()
    await recipient.goto(url)
    await recipient
      .getByRole("button", { name: "Accept and become the owner" })
      .click()
    await expect(recipient).toHaveURL(`${dashboardURL}/p/${projectId}`)
    await expect(recipient.getByText(body, { exact: true })).toBeVisible()
    await ownerPage.goto(`${dashboardURL}/p/${projectId}`)
    await expect(
      ownerPage.getByText("Project not found", { exact: true })
    ).toBeVisible()
    await recipient.goto(url)
    await expect(
      recipient.getByText("This link no longer works", { exact: true })
    ).toBeVisible()
  } finally {
    await context.storageState({ path: ".auth/second-owner.json" })
    await context.close()
  }
})

test("unknown pages offer a working route back to projects", async ({
  ownerPage,
  projectId,
}) => {
  await ownerPage.goto(`${dashboardURL}/missing/${projectId}`)
  await expect(
    ownerPage.getByRole("heading", { name: "Page not found" })
  ).toBeVisible()
  await ownerPage.getByRole("link", { name: "Go to your projects" }).click()
  await expect(
    ownerPage.getByRole("heading", { name: "Projects", exact: true })
  ).toBeVisible()
})
