import { COMMENT_PARAM } from "@nuni/shared"

import { URLS, USERS } from "../../env"
import { expect, test } from "../../fixtures"
import { addComment, choosePlan, claimProject, cliSession } from "../../helpers"

test("dashboard approval signs in the CLI to read, reply and resolve", async ({
  widget,
  ownerPage,
  projectId,
}, testInfo) => {
  const body = "Make the pricing button easier to find"
  await addComment(widget, body)
  await claimProject(ownerPage, projectId)
  const cli = cliSession(testInfo, projectId)
  await cli.login(ownerPage)
  const identity = JSON.parse(await cli.run("whoami", "--json"))
  expect(identity).toMatchObject({ project: projectId, signedIn: true })
  expect(identity.owner).toBe(USERS.owner.name)
  const id = await cli.commentId(body)
  const shown = await cli.run("comment", id)
  expect(shown).toContain(`> ${body}`)
  // The link that opens the comment on its page.
  expect(shown).toContain(`${URLS.playground}/pricing?`)
  expect(shown).toContain(`${COMMENT_PARAM}=${id}`)

  const reply = "Updated the button contrast"
  expect(await cli.run("reply", id, reply)).toContain(`Replied to ${id}`)
  await widget.pins.click()
  await expect(widget.thread).toContainText(reply)

  expect(await cli.run("resolve", id)).toContain(`Resolved ${id}`)
  await expect(widget.thread).toContainText("Resolved")
  const resolved = JSON.parse(
    await cli.run("comments", "--status", "resolved", "--json")
  ) as { comments: { _id: string }[] }
  expect(resolved.comments.map((comment) => comment._id)).toEqual([id])
  expect(await cli.run("logout")).toContain("Signed out")
  await expect(cli.run("comments")).rejects.toThrow()
})

test("agents search, list pages, group and resolve several comments", async ({
  widget,
  ownerPage,
  projectId,
}, testInfo) => {
  const first = "Typo in the pricing heading"
  const second = "Another typo in the footer"
  const third = "Make the logo bigger"
  await addComment(widget, first)
  await widget.comment(choosePlan(widget.page), second)
  await widget.comment(choosePlan(widget.page), third)
  await claimProject(ownerPage, projectId)
  const cli = cliSession(testInfo, projectId)
  await cli.login(ownerPage)

  const found = JSON.parse(
    await cli.run("comments", "--search", "typo", "--json")
  ) as { comments: { _id: string; body: string }[] }
  expect(found.comments.map((c) => c.body).sort()).toEqual([second, first])
  expect(await cli.run("pages")).toMatch(/3 open {2}\//)
  expect(await cli.run("comments", "--group", "page")).toContain(
    "grouped by page"
  )

  const client = await cli.mcp()
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
  const open = JSON.parse(await cli.run("comments", "--json")) as {
    comments: { body: string }[]
  }
  expect(open.comments.map((c) => c.body)).toEqual([third])
})
