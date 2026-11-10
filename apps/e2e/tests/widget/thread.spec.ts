import { SEEDED_OWNER, expect, test } from "../../fixtures"
import type { Widget } from "../../widget"

const price = (widget: Widget, plan: number) =>
  widget.page.locator(".plan").nth(plan).locator(".price")

test("replies and reactions sync live, with an Owner badge", async ({
  widget,
  newVisitor,
  ownerWidget: owner,
}) => {
  const body = `Can this be blue? ${Date.now()}`
  await widget.goto("/pricing")
  await widget.comment(price(widget, 0), body, { name: "Sam Visitor" })

  // A second visitor follows the same thread.
  const other = await newVisitor()
  await other.goto("/pricing")
  await other.openThread(body)

  await widget.openThread(body)
  await widget.reply("Also the border")
  await expect(widget.replies).toHaveCount(1)
  await expect(other.replies).toHaveCount(1)
  await expect(other.replies).toContainText("Sam Visitor")
  await expect(other.replies).toContainText("Also the border")
  // The visitor can delete their own reply; the other visitor can't.
  await expect(
    widget.replies.getByRole("button", { name: "Delete reply" })
  ).toHaveCount(1)
  await expect(
    other.replies.getByRole("button", { name: "Delete reply" })
  ).toHaveCount(0)

  // Reactions on the comment: one each, counted live.
  await widget.commentReactions
    .getByRole("button", { name: "Add a reaction" })
    .click()
  await widget.commentReactions
    .getByRole("button", { name: "React with 👍" })
    .click()
  await other.commentReactions.getByRole("button", { name: /👍 1/ }).click()
  await expect(
    widget.commentReactions.getByRole("button", { name: /👍 2/ })
  ).toHaveAttribute("aria-pressed", "true")
  // Clicking your own reaction again takes it back.
  await widget.commentReactions.getByRole("button", { name: /👍 2/ }).click()
  await expect(
    other.commentReactions.getByRole("button", { name: /👍 1/ })
  ).toHaveAttribute("aria-pressed", "true")

  // The owner replies from the widget with a badge.
  await owner.goto("/pricing")
  await owner.openThread(body)
  await owner.reply("Done, it's blue now")
  await expect(widget.replies).toHaveCount(2)
  const ownerReply = widget.replies.nth(1)
  await expect(ownerReply).toContainText(SEEDED_OWNER)
  await expect(widget.ownerBadge(ownerReply)).toHaveText("Owner")

  // The panel shows the reply count.
  await widget.page.keyboard.press("Escape")
  await expect(widget.item(body)).toContainText("2 replies")
})

test("pressing the page closes the card unless it has unsent words", async ({
  widget,
}) => {
  const body = `Close me like Figma ${Date.now()}`
  await widget.goto("/pricing")
  const elsewhere = price(widget, 2)

  // An empty composer closes; one with words stays open.
  await widget.startComment(price(widget, 0))
  await elsewhere.click()
  await expect(widget.composer).toHaveCount(0)

  await widget.startComment(price(widget, 0))
  await widget.bodyField.fill(body)
  await elsewhere.click()
  await expect(widget.composer).toBeVisible()
  await widget.post(body)

  // The thread closes on a press outside it, but not while a reply is typed.
  await widget.pins.click()
  await expect(widget.thread).toContainText(body)
  await elsewhere.click()
  await expect(widget.thread).toHaveCount(0)

  await widget.pins.click()
  const reply = widget.thread.getByRole("textbox", { name: "Reply" })
  await reply.fill("Half a thought")
  await elsewhere.click()
  await expect(widget.thread).toBeVisible()
  await reply.fill("")
  await elsewhere.click()
  await expect(widget.thread).toHaveCount(0)
})
