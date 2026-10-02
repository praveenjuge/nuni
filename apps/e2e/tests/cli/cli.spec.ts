import { expect, test } from "../../fixtures"
import { addComment, claimProject } from "../../helpers"

import { cliSession, commentId } from "./support"

test("dashboard approval signs in the CLI to read, reply and resolve", async ({
  page,
  ownerPage,
  projectId,
}, testInfo) => {
  const body = "Make the pricing button easier to find"
  await addComment(page, projectId, body)
  await claimProject(ownerPage, projectId)
  const session = cliSession(testInfo, projectId)
  await session.login(ownerPage)
  const identity = JSON.parse(await session.run("whoami", "--json"))
  expect(identity).toMatchObject({ project: projectId, signedIn: true })
  expect(identity.owner).toBeTruthy()
  const id = await commentId(session, body)
  expect(await session.run("comment", id)).toContain(`> ${body}`)

  const reply = "Updated the button contrast"
  expect(await session.run("reply", id, reply)).toContain(`Replied to ${id}`)
  await page.locator("#nuni-root .pin:not(.pin-draft)").click()
  const thread = page.locator('#nuni-root [data-card="thread"]')
  await expect(thread).toContainText(reply)

  expect(await session.run("resolve", id)).toContain(`Resolved ${id}`)
  await expect(thread).toContainText("Resolved")
  const resolved = JSON.parse(
    await session.run("comments", "--status", "resolved", "--json")
  ) as { comments: { _id: string }[] }
  expect(resolved.comments.map((comment) => comment._id)).toEqual([id])
  expect(await session.run("logout")).toContain("Signed out")
  await expect(session.run("comments")).rejects.toThrow()
})

test("MCP stdio lists, replies and resolves with real owner credentials", async ({
  page,
  ownerPage,
  projectId,
}, testInfo) => {
  const body = "Explain the pricing tiers"
  await addComment(page, projectId, body)
  await claimProject(ownerPage, projectId)
  const session = cliSession(testInfo, projectId)
  await session.login(ownerPage)
  const id = await commentId(session, body)
  const client = await session.mcp()
  try {
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_comments",
        "reply_to_comment",
        "resolve_comment",
      ])
    )
    const listed = await client.callTool({
      name: "list_comments",
      arguments: {},
    })
    expect(listed.isError).not.toBe(true)
    expect(JSON.stringify(listed.content)).toContain(body)
    const reply = "Added a short explanation for each tier"
    const replied = await client.callTool({
      name: "reply_to_comment",
      arguments: { id, body: reply },
    })
    expect(replied.isError).not.toBe(true)
    await page.locator("#nuni-root .pin:not(.pin-draft)").click()
    const thread = page.locator('#nuni-root [data-card="thread"]')
    await expect(thread).toContainText(reply)
    const resolved = await client.callTool({
      name: "resolve_comment",
      arguments: { id },
    })
    expect(resolved.isError).not.toBe(true)
    await expect(thread).toContainText("Resolved")
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
})
