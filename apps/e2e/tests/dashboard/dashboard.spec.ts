import { dashboardPath, projectRoute } from "@nuni/shared"
import type { Page } from "@playwright/test"

import { expect, test } from "../../fixtures"
import {
  addComment,
  choosePlan,
  claimProject,
  dashboard,
  projectPage,
} from "../../helpers"

const projectLink = (page: Page, projectId: string) =>
  page.locator(`a[href='${dashboardPath(projectRoute(projectId))}']`)

test("claimed projects and widget comments appear and resolve live", async ({
  widget,
  ownerPage,
  projectId,
}) => {
  const body = `Dashboard review ${projectId}`
  await addComment(widget, body)
  await claimProject(ownerPage, projectId)
  await ownerPage.goto(dashboard())
  const project = projectLink(ownerPage, projectId)
  await expect(project).toContainText("1 open")
  await expect(project).toContainText("1 comment")
  await project.click()
  const detail = ownerPage.getByRole("article", { name: "Selected comment" })
  await expect(detail.getByText(body, { exact: true })).toBeVisible()
  await detail.getByRole("button", { name: "Resolve", exact: true }).click()
  await expect(
    ownerPage.getByRole("tab", { name: "Open 0", exact: true })
  ).toBeVisible()
  await widget.expectOpenCount(0)
  await ownerPage.getByRole("tab", { name: "Resolved 1", exact: true }).click()
  await detail.getByRole("button", { name: "Reopen", exact: true }).click()
  await widget.expectOpenCount(1)
  await ownerPage.getByRole("tab", { name: "Open 1", exact: true }).click()
  await expect(
    ownerPage
      .getByRole("list", { name: "Open comments" })
      .getByText(body, { exact: true })
  ).toBeVisible()
})

test("triage comments: reply, undo, bulk resolve and delete", async ({
  widget,
  ownerPage,
  projectId,
}) => {
  const first = `First triage ${projectId}`
  const second = `Second triage ${projectId}`
  await addComment(widget, first)
  await widget.comment(choosePlan(widget.page), second)
  await claimProject(ownerPage, projectId)
  await ownerPage.goto(projectPage(projectId))
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
  const bulkResolve = ownerPage
    .getByRole("toolbar", { name: "Bulk actions" })
    .getByRole("button", { name: "Resolve", exact: true })
  await bulkResolve.click()
  await expect(
    ownerPage.getByRole("tab", { name: "Resolved 2", exact: true })
  ).toBeVisible()
  await widget.expectOpenCount(0)

  // A bulk resolve can be undone too.
  await ownerPage.getByRole("button", { name: "Undo" }).click()
  await expect(
    ownerPage.getByRole("tab", { name: "Open 2", exact: true })
  ).toBeVisible()
  await widget.expectOpenCount(2)
  await ownerPage
    .getByRole("checkbox", { name: "Select all comments shown" })
    .click()
  await bulkResolve.click()
  await expect(
    ownerPage.getByRole("tab", { name: "Resolved 2", exact: true })
  ).toBeVisible()

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

test("rename, add and remove a site, and delete a project", async ({
  ownerPage,
  projectId,
}) => {
  await claimProject(ownerPage, projectId)
  await ownerPage.goto(`${projectPage(projectId)}/settings`)
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
  const sites = ownerPage.getByRole("list", { name: "Sites" })
  await expect(
    sites.getByText("staging.example.com", { exact: true })
  ).toBeVisible()
  await sites
    .getByRole("button", { name: "Remove staging.example.com", exact: true })
    .click()
  await ownerPage
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove site", exact: true })
    .click()
  await expect(
    sites.getByText("staging.example.com", { exact: true })
  ).toHaveCount(0)
  await ownerPage.reload()
  await expect(sites.getByRole("listitem")).not.toHaveCount(0)
  await expect(
    sites.getByText("staging.example.com", { exact: true })
  ).toHaveCount(0)
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
  await expect(ownerPage).toHaveURL(dashboard())
  await expect(projectLink(ownerPage, projectId)).toHaveCount(0)
  await ownerPage.goto(projectPage(projectId))
  await expect(
    ownerPage.getByText("Project not found", { exact: true })
  ).toBeVisible()
})

test("owner transfers a project once and loses access", async ({
  widget,
  ownerPage,
  secondOwnerPage: recipient,
  projectId,
}) => {
  const body = `Transferred feedback ${projectId}`
  await addComment(widget, body)
  await claimProject(ownerPage, projectId)
  await ownerPage.goto(`${projectPage(projectId)}/settings`)
  await ownerPage
    .getByRole("button", { name: "Make a link", exact: true })
    .click()
  const link = ownerPage
    .locator("code")
    .filter({ hasText: "/dashboard/transfer?token=" })
  await expect(link).toBeVisible()
  const url = (await link.textContent())!
  await recipient.goto(url)
  await recipient
    .getByRole("button", { name: "Accept and become the owner" })
    .click()
  await expect(recipient).toHaveURL(projectPage(projectId))
  await expect(
    recipient
      .getByRole("list", { name: "Open comments" })
      .getByText(body, { exact: true })
  ).toBeVisible()
  await ownerPage.goto(projectPage(projectId))
  await expect(
    ownerPage.getByText("Project not found", { exact: true })
  ).toBeVisible()
  await recipient.goto(url)
  await expect(
    recipient.getByText("This link no longer works", { exact: true })
  ).toBeVisible()
})

test("unknown pages offer a working route back to projects", async ({
  ownerPage,
  projectId,
}) => {
  await ownerPage.goto(dashboard(`/missing/${projectId}`))
  await expect(
    ownerPage.getByRole("heading", { name: "Page not found" })
  ).toBeVisible()
  await ownerPage.getByRole("link", { name: "Go to your projects" }).click()
  await expect(
    ownerPage.getByRole("heading", { name: "Projects", exact: true })
  ).toBeVisible()
})

test("suggested text changes show the old and new words", async ({
  widget,
  ownerPage,
  projectId,
}) => {
  await widget.goto("/pricing")
  await widget.startComment(choosePlan(widget.page))
  await widget.nameField.fill("Val Visitor")
  await widget.composer.getByRole("button", { name: "Suggest an edit" }).click()
  await widget.newTextField.fill("Pick a plan")
  await widget.composer.getByRole("button", { name: "Post" }).click()
  await expect(widget.toast).toHaveText("Comment added")

  await claimProject(ownerPage, projectId)
  await ownerPage
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"])
  await ownerPage.goto(projectPage(projectId))
  const detail = ownerPage.getByRole("article", { name: "Selected comment" })
  const edit = detail.getByRole("region", { name: "Suggested edit" })
  await expect(edit.locator("del")).toHaveText("Choose plan")
  await expect(edit.locator("ins")).toHaveText("Pick a plan")
  await edit.getByRole("button", { name: "Copy new text" }).click()
  await expect(ownerPage.getByText("New text copied")).toBeVisible()
  expect(await ownerPage.evaluate(() => navigator.clipboard.readText())).toBe(
    "Pick a plan"
  )
  await expect(
    ownerPage
      .getByRole("list", { name: "Open comments" })
      .getByText("Choose plan")
  ).toBeVisible()
})

test("pins visitors can't find show under Not found and close as outdated", async ({
  widget,
  ownerPage,
  projectId,
}) => {
  const heading = widget.page.locator(".pricing h1")
  await widget.goto("/pricing")
  await widget.comment(heading, "Heading copy")

  await claimProject(ownerPage, projectId)
  await ownerPage.goto(projectPage(projectId))
  await expect(ownerPage.getByRole("tab", { name: /Not found/ })).toHaveCount(0)

  // The heading is gone for a visitor; their widget reports it.
  await heading.evaluate((el) => el.remove())
  const lostTab = ownerPage.getByRole("tab", { name: /Not found\s+1/ })
  await expect(lostTab).toBeVisible({ timeout: 15_000 })
  await lostTab.click()
  const list = ownerPage.getByRole("list", {
    name: "Comments not found on their page",
  })
  await expect(list).toContainText("not found")
  const detail = ownerPage.getByRole("article", { name: "Selected comment" })
  await expect(
    detail.getByRole("region", { name: "Pin not found" })
  ).toBeVisible()

  await ownerPage
    .getByRole("checkbox", { name: "Select all comments shown" })
    .click()
  await ownerPage
    .getByRole("toolbar", { name: "Bulk actions" })
    .getByRole("button", { name: "Close as outdated" })
    .click()
  await expect(
    ownerPage.getByText("1 comment closed as outdated")
  ).toBeVisible()
  await widget.expectOpenCount(0)
  await ownerPage.getByRole("tab", { name: /Resolved\s+1/ }).click()
  await expect(
    ownerPage.getByRole("list", { name: "Resolved comments" })
  ).toContainText("outdated")
  await expect(detail).toContainText("Closed as outdated")
})
