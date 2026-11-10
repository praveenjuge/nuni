import { expect, test } from "../../fixtures"
import { addComment, choosePlan } from "../../helpers"

test("owner resolves and deletes from the widget; visitors see it live", async ({
  widget: visitor,
  ownerWidget: owner,
}) => {
  await addComment(visitor, "Typo in the plan name")
  await visitor.expectOpenCount(1)

  await owner.goto("/pricing")
  await owner.openThread("Typo in the plan name")
  // Owner can resolve and delete, but not edit someone else's words.
  await expect(owner.thread.getByRole("button", { name: "Edit" })).toHaveCount(
    0
  )
  await owner.thread.getByRole("button", { name: "Resolve" }).click()
  await expect(owner.toast).toHaveText("Resolved")
  await visitor.expectOpenCount(0)
  await expect(visitor.pins).toHaveCount(0)

  await visitor.comment(choosePlan(visitor.page), "Second open comment")
  await visitor.expectOpenCount(1)

  // Reopen from the Resolved tab, then delete.
  await owner.tab(/Resolved/).click()
  await expect(owner.pinsWithStatus("resolved")).toHaveCount(1)
  await expect(owner.pinsWithStatus("open")).toHaveCount(0)
  await owner.tab(/Open/).click()
  await expect(owner.pinsWithStatus("resolved")).toHaveCount(0)
  await expect(owner.pinsWithStatus("open")).toHaveCount(1)
  await owner.tab(/Resolved/).click()
  await owner.item("Typo in the plan name").click()
  await owner.thread.getByRole("button", { name: "Reopen" }).click()
  await visitor.expectOpenCount(2)
  await owner.thread.getByRole("button", { name: "Delete" }).click()
  const confirmDelete = owner.confirm.getByRole("button", { name: "Delete" })
  // White text on the danger color, not on the dialog's own background.
  await expect(confirmDelete).toHaveCSS(
    "background-color",
    await owner.themeColor("--n-danger")
  )
  await confirmDelete.click()
  await visitor.expectOpenCount(1)
})

test("owner moves a lost pin, then closes it as outdated", async ({
  widget: visitor,
  ownerWidget: owner,
}) => {
  await visitor.goto("/pricing")
  await visitor.comment(
    visitor.page.locator(".pricing h1"),
    "Rename this heading"
  )

  await owner.goto("/pricing")
  await expect(owner.pins).toHaveCount(1)

  // A redesign removed the heading: the owner points the pin elsewhere.
  await owner.page.locator(".pricing h1").evaluate((el) => el.remove())
  await owner.openThread("Rename this heading")
  const lost = owner.lostNote
  await expect(lost).toBeVisible()
  await owner.thread.getByRole("button", { name: "Move pin" }).click()
  await expect(owner.pickHint).toHaveText(
    "Click the element this comment is about"
  )
  const planName = owner.page.locator(".plan").nth(1).locator(".plan-name")
  await planName.click()
  await expect(owner.toast).toHaveText("Pin moved")
  await expect(owner.thread).toBeVisible()
  await expect(lost).toHaveCount(0)

  // Visitors now see it on the new element.
  await visitor.reload()
  await expect(visitor.confidentPins).toHaveCount(1)

  // Gone again, and no longer relevant: closed as outdated.
  await planName.evaluate((el) => el.remove())
  await expect(lost).toBeVisible()
  await owner.thread.getByRole("button", { name: "Close as outdated" }).click()
  await expect(owner.toast).toHaveText("Closed as outdated")
  await visitor.expectOpenCount(0)
})
