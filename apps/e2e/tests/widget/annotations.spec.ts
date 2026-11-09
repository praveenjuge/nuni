import { expect, test } from "../../fixtures"
import { choosePlan } from "../../helpers"
import { near, type Box } from "../../widget"

/** Wait until one of the boxes `read` returns sits where `expected` is. */
async function expectBox(read: () => Promise<Box[]>, expected: Box, slack = 4) {
  await expect
    .poll(async () => (await read()).some((b) => near(b, expected, slack)))
    .toBe(true)
}

test("comments on selected text find the same words after a reload", async ({
  widget,
}) => {
  const { page } = widget
  await widget.goto("/")

  // Select words: a Comment button shows under them.
  const lead = page.locator(".lead")
  await widget.selectWords(lead, "ship your product")
  await widget.selectionButton.click()
  await expect(widget.quote(widget.composer)).toHaveText("ship your product")
  await widget.post(`Say what it ships ${Date.now()}`, { name: "Sam Tester" })

  // The words are marked on the page.
  const lead1 = await widget.wordBoxes(lead, "ship your product")
  const marks = () => widget.markBoxes()
  await expect.poll(async () => (await marks()).length).toBe(lead1.length)
  for (const box of lead1) await expectBox(marks, box)

  // The same phrase in the second of three cards, commented with C.
  const card = page.locator(".feature").nth(1)
  await widget.selectWords(card, "your team can focus")
  await page.keyboard.press("c")
  await expect(widget.quote(widget.composer)).toHaveText("your team can focus")
  await widget.post(`Which team? ${Date.now()}`)

  await widget.reload()
  await expect(widget.pins).toHaveCount(2)
  const cardBoxes = await widget.wordBoxes(card, "your team can focus")
  await expect
    .poll(async () => (await marks()).length)
    .toBe(lead1.length + cardBoxes.length)
  for (const box of lead1) await expectBox(marks, box)
  for (const box of cardBoxes) await expectBox(marks, box)

  // The thread shows the words.
  await widget.openThread("Which team?")
  await expect(widget.quote(widget.thread)).toHaveText("your team can focus")
  await expect
    .poll(async () => (await widget.markBoxes({ active: true })).length)
    .toBe(cardBoxes.length)
})

test("an area dragged while picking is shown again on its element", async ({
  widget,
  projectId,
}) => {
  const { page } = widget
  await widget.goto("/")
  await widget.commentButton.click()

  const box = (await page.locator(".hero").boundingBox())!
  const from = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.3 }
  const to = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.7 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 2 })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await expect
    .poll(async () => (await widget.areaBoxes({ dragging: true })).length)
    .toBe(1)
  await page.mouse.up()
  await expect(widget.composer).toBeVisible()
  // The page's links and buttons under the drag were not clicked.
  await expect(page).toHaveURL(new RegExp(`/\\?project=${projectId}$`))
  const expected = {
    x: from.x,
    y: from.y,
    width: to.x - from.x,
    height: to.y - from.y,
  }
  const areas = () => widget.areaBoxes()
  await expectBox(areas, expected, 3)
  await widget.post(`This whole block ${Date.now()}`, { name: "Sam Tester" })

  await widget.reload()
  await expect(widget.pins).toHaveCount(1)
  await widget.pins.click()
  await expect(widget.thread).toBeVisible()
  await expectBox(areas, expected, 3)
})

test("suggest new words for selected text or a button, then edit them", async ({
  widget,
}) => {
  const { page } = widget
  await widget.goto("/")

  // Selected words: the new words alone are enough to post.
  await widget.selectWords(page.locator(".lead"), "ship your product")
  await widget.selectionButton.click()
  await widget.nameField.fill("Sam Tester")
  const suggest = widget.composer.getByRole("button", {
    name: "Suggest an edit",
  })
  await suggest.click()
  await expect(widget.newTextField).toHaveValue("ship your product")
  await expect(widget.newTextField).toBeFocused()
  const postButton = widget.composer.getByRole("button", { name: "Post" })
  await expect(postButton).toBeDisabled()
  await widget.newTextField.fill("launch faster")
  await postButton.click()
  await expect(widget.toast).toHaveText("Comment added")

  await widget.pins.click()
  const edit = widget.suggestion(widget.thread)
  await expect(edit.before).toHaveText("ship your product")
  await expect(edit.after).toHaveText("launch faster")
  await expect(widget.threadBody).toHaveCount(0)

  // The author can change the new words.
  await widget.thread.getByRole("button", { name: "Edit" }).click()
  await widget.newTextField.fill("ship it faster")
  await widget.thread.getByRole("button", { name: "Save" }).click()
  await expect(edit.after).toHaveText("ship it faster")

  // A button's whole text, with a note.
  await widget.goto("/pricing")
  await widget.startComment(choosePlan(page))
  await suggest.click()
  await expect(widget.newTextField).toHaveValue("Choose plan")
  await widget.newTextField.fill("Pick this plan")
  await widget.post("Clearer")

  // Both show in the panel as old → new, after a reload.
  await widget.reload()
  await widget.openPanel()
  await expect(widget.itemSuggestion(widget.item("Clearer"))).toHaveText(
    "Choose plan → Pick this plan"
  )
})
