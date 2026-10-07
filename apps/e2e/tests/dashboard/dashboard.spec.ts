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
  await expect(project).toContainText("1 comment")
  await project.click()
  const detail = ownerPage.getByRole("article", { name: "Selected comment" })
  await expect(detail.getByText(body, { exact: true })).toBeVisible()
  await detail.getByRole("button", { name: "Resolve", exact: true }).click()
  await expect(
    ownerPage.getByRole("tab", { name: "Open 0", exact: true })
  ).toBeVisible()
  await expect(page.locator("#nuni-root .tb-count")).toHaveText("0")
  await ownerPage.getByRole("tab", { name: "Resolved 1", exact: true }).click()
  await detail.getByRole("button", { name: "Reopen", exact: true }).click()
  await expect(page.locator("#nuni-root .tb-count")).toHaveText("1")
  await ownerPage.getByRole("tab", { name: "Open 1", exact: true }).click()
  await expect(
    ownerPage
      .getByRole("list", { name: "Open comments" })
      .getByText(body, { exact: true })
  ).toBeVisible()
})

test("triage comments: reply, undo, bulk resolve and delete", async ({
  page,
  ownerPage,
  projectId,
}) => {
  const first = `First triage ${projectId}`
  const second = `Second triage ${projectId}`
  await addComment(page, projectId, first)
  await addComment(page, projectId, second)
  await claimProject(ownerPage, projectId)
  await ownerPage.goto(`${dashboardURL}/p/${projectId}`)
  const open = ownerPage.getByRole("list", { name: "Open comments" })
  const detail = ownerPage.getByRole("article", { name: "Selected comment" })

  // Picking a row shows it in the detail panel; the owner replies there.
  await open.getByRole("button", { name: new RegExp(first) }).click()
  await expect(detail.getByText(first, { exact: true })).toBeVisible()
  await detail.getByRole("textbox", { name: "Reply" }).fill("On it")
  await detail.getByRole("button", { name: "Send reply" }).click()
  await expect(
    detail.getByRole("list", { name: "Replies" }).getByText("On it")
  ).toBeVisible()

  // Resolving can be undone from the toast.
  await detail.getByRole("button", { name: "Resolve", exact: true }).click()
  await expect(
    ownerPage.getByRole("tab", { name: "Open 1", exact: true })
  ).toBeVisible()
  await ownerPage.getByRole("button", { name: "Undo" }).click()
  await expect(
    ownerPage.getByRole("tab", { name: "Open 2", exact: true })
  ).toBeVisible()

  // Select every comment and resolve them together.
  await ownerPage
    .getByRole("checkbox", { name: "Select all comments shown" })
    .click()
  await expect(ownerPage.getByText("2 selected")).toBeVisible()
  await ownerPage
    .getByRole("toolbar", { name: "Bulk actions" })
    .getByRole("button", { name: "Resolve", exact: true })
    .click()
  await expect(
    ownerPage.getByRole("tab", { name: "Resolved 2", exact: true })
  ).toBeVisible()
  await expect(page.locator("#nuni-root .tb-count")).toHaveText("0")

  // Deleting asks first.
  await ownerPage.getByRole("tab", { name: "Resolved 2", exact: true }).click()
  await ownerPage
    .getByRole("list", { name: "Resolved comments" })
    .getByRole("button", { name: new RegExp(second) })
    .click()
  await detail.getByRole("button", { name: "More actions" }).click()
  await ownerPage.getByRole("menuitem", { name: "Delete comment" }).click()
  await ownerPage
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete comment" })
    .click()
  await expect(
    ownerPage.getByRole("tab", { name: "Resolved 1", exact: true })
  ).toBeVisible()
  await expect(ownerPage.getByText(second, { exact: true })).toHaveCount(0)
})

test("rename, allow another origin, and delete a project", async ({
  ownerPage,
  projectId,
}) => {
  await claimProject(ownerPage, projectId)
  await ownerPage.goto(`${dashboardURL}/p/${projectId}/settings`)
  await ownerPage
    .getByRole("textbox", { name: "Add a site origin" })
    .fill("https://staging.example.com")
  await ownerPage.getByRole("button", { name: "Add site", exact: true }).click()
  await expect(
    ownerPage
      .getByRole("list", { name: "Sites" })
      .getByText("staging.example.com", { exact: true })
  ).toBeVisible()
  await ownerPage.reload()
  await expect(
    ownerPage
      .getByRole("list", { name: "Sites" })
      .getByText("staging.example.com", { exact: true })
  ).toBeVisible()
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
  await ownerPage.getByRole("button", { name: "Delete project" }).click()
  const confirm = ownerPage.getByRole("alertdialog")
  await expect(
    confirm.getByRole("button", { name: "Delete project" })
  ).toBeDisabled()
  await confirm.getByLabel(`Type ${name} to confirm`).fill(name)
  await confirm.getByRole("button", { name: "Delete project" }).click()
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
    await expect(
      recipient
        .getByRole("list", { name: "Open comments" })
        .getByText(body, { exact: true })
    ).toBeVisible()
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
