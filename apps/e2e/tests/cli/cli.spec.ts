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

test("agents search, list pages, group and resolve several comments", async ({
  page,
  ownerPage,
  projectId,
}, testInfo) => {
  const first = "Typo in the pricing heading"
  const second = "Another typo in the footer"
  const third = "Make the logo bigger"
  await addComment(page, projectId, first)
  await addComment(page, projectId, second)
  await addComment(page, projectId, third)
  await claimProject(ownerPage, projectId)
  const session = cliSession(testInfo, projectId)
  await session.login(ownerPage)

  const found = JSON.parse(
    await session.run("comments", "--search", "typo", "--json")
  ) as { comments: { _id: string; body: string }[] }
  expect(found.comments.map((c) => c.body).sort()).toEqual([second, first])
  expect(await session.run("pages")).toMatch(/3 open {2}\//)
  expect(await session.run("comments", "--group", "page")).toContain(
    "grouped by page"
  )

  const client = await session.mcp()
  try {
    const pages = await client.callTool({ name: "list_pages", arguments: {} })
    expect(pages.isError).not.toBe(true)
    expect(JSON.stringify(pages.content)).toContain("3 open")
    const searched = await client.callTool({
      name: "search_comments",
      arguments: { query: "typo", group_by: "page" },
    })
    expect(searched.isError).not.toBe(true)
    expect(JSON.stringify(searched.content)).toContain(first)
    expect(JSON.stringify(searched.content)).not.toContain(third)
    const resolved = await client.callTool({
      name: "resolve_comments",
      arguments: {
        ids: found.comments.map((c) => c._id),
        note: "Fixed both typos",
      },
    })
    expect(resolved.isError).not.toBe(true)
  } finally {
    await client.close()
  }
  const open = JSON.parse(await session.run("comments", "--json")) as {
    comments: { body: string }[]
  }
  expect(open.comments.map((c) => c.body)).toEqual([third])
})
