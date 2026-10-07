import { isProjectId } from "@nuni/shared"

import { expect, test } from "../fixtures"
import { addComment, claimProject } from "../helpers"

import { cliSession, commentId } from "./cli/support"

test("README journey: init, visitor feedback, owner claim, MCP fix, live result", async ({
  page,
  ownerPage,
}, testInfo) => {
  const session = cliSession(testInfo)
  const initialized = JSON.parse(await session.run("init", "--json")) as {
    projectId: string
    snippet: string
  }
  expect(isProjectId(initialized.projectId)).toBe(true)
  expect(initialized.snippet).toContain(initialized.projectId)
  const projectId = initialized.projectId
  session.env.NUNI_PROJECT = projectId

  const body = "Make the call to action clearer"
  await addComment(page, projectId, body)
  await claimProject(ownerPage, projectId)
  await ownerPage.goto(`http://localhost:3000/dashboard/p/${projectId}`)
  await expect(
    ownerPage
      .getByRole("list", { name: "Open comments" })
      .getByText(body, { exact: true })
  ).toBeVisible()
  await session.login(ownerPage)
  const id = await commentId(session, body)

  await page.locator("#nuni-root .pin:not(.pin-draft)").click()
  const thread = page.locator('#nuni-root [data-card="thread"]')
  await expect(thread).toContainText(body)
  const client = await session.mcp()
  try {
    const listed = await client.callTool({
      name: "list_comments",
      arguments: {},
    })
    expect(JSON.stringify(listed.content)).toContain(body)
    const reply = "Updated the call to action"
    const replied = await client.callTool({
      name: "reply_to_comment",
      arguments: { id, body: reply },
    })
    expect(replied.isError).not.toBe(true)
    await expect(thread).toContainText(reply)
    const resolved = await client.callTool({
      name: "resolve_comment",
      arguments: { id },
    })
    expect(resolved.isError).not.toBe(true)
    await expect(thread).toContainText("Resolved")
    await ownerPage.goto(`http://localhost:3000/dashboard/p/${projectId}`)
    await ownerPage.getByRole("tab", { name: /Resolved/ }).click()
    await expect(
      ownerPage
        .getByRole("list", { name: "Resolved comments" })
        .getByText(body, { exact: true })
    ).toBeVisible()
    await testInfo.attach("visitor-live-result", {
      body: await page.screenshot(),
      contentType: "image/png",
    })
  } finally {
    await client.close()
  }
})
