import { MCP_TOOLS, isProjectId } from "@nuni/shared"

import { expect, test } from "../fixtures"
import { addComment, claimProject, cliSession, projectPage } from "../helpers"
import { Widget } from "../widget"

test("README journey: init, visitor feedback, owner claim, MCP fix, live result", async ({
  page,
  ownerPage,
}, testInfo) => {
  const initialized = JSON.parse(
    await cliSession(testInfo).run("init", "--json")
  ) as { projectId: string; snippet: string }
  expect(isProjectId(initialized.projectId)).toBe(true)
  expect(initialized.snippet).toContain(initialized.projectId)
  const projectId = initialized.projectId
  const widget = new Widget(page, projectId)

  const body = "Make the call to action clearer"
  await addComment(widget, body)
  await claimProject(ownerPage, projectId)
  await ownerPage.goto(projectPage(projectId))
  await expect(
    ownerPage
      .getByRole("list", { name: "Open comments" })
      .getByText(body, { exact: true })
  ).toBeVisible()
  const cli = cliSession(testInfo, projectId)
  await cli.login(ownerPage)
  const id = await cli.commentId(body)

  await widget.pins.click()
  await expect(widget.thread).toContainText(body)
  const client = await cli.mcp()
  try {
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_comments",
        "reply_to_comment",
        MCP_TOOLS.resolveComment,
      ])
    )
    const listed = await client.callTool({
      name: "list_comments",
      arguments: {},
    })
    expect(listed.isError).not.toBe(true)
    expect(JSON.stringify(listed.content)).toContain(body)
    const reply = "Updated the call to action"
    const replied = await client.callTool({
      name: "reply_to_comment",
      arguments: { id, body: reply },
    })
    expect(replied.isError).not.toBe(true)
    await expect(widget.thread).toContainText(reply)
    const resolved = await client.callTool({
      name: MCP_TOOLS.resolveComment,
      arguments: { id },
    })
    expect(resolved.isError).not.toBe(true)
    await expect(widget.thread).toContainText("Resolved")
    const remaining = await client.callTool({
      name: "list_comments",
      arguments: {},
    })
    expect(JSON.stringify(remaining.content)).not.toContain(body)
    const completed = await client.callTool({
      name: "list_comments",
      arguments: { status: "resolved" },
    })
    expect(JSON.stringify(completed.content)).toContain(body)
  } finally {
    await client.close()
  }
  await ownerPage.goto(projectPage(projectId))
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
})
