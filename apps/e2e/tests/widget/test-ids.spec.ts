import { EN } from "../../../../packages/widget/src/i18n"
import { expect, pageComments, test } from "../../fixtures"
import { near } from "../../widget"

// `data-nuni` is a test id site owners put on their own elements: its text is
// page content like any other.
test("text in a data-nuni element is commented on and found again", async ({
  widget,
}) => {
  const { page } = widget
  const tagline = page.locator('[data-nuni="tagline"]')
  const words = "teams that ship"
  await widget.goto("/")
  await widget.selectWords(tagline, words)
  await widget.selectionButton.click()
  await expect(widget.quote(widget.composer)).toHaveText(words)
  await widget.post(`Which teams? ${Date.now()}`)

  await widget.reload()
  await expect(widget.pins).toHaveCount(1)
  const expected = await widget.wordBoxes(tagline, words)
  await expect
    .poll(async () => {
      const marks = await widget.markBoxes()
      return (
        marks.length === expected.length &&
        expected.every((box) => marks.some((mark) => near(mark, box)))
      )
    })
    .toBe(true)
})

test("an area comment never records the widget's own words", async ({
  widget,
  projectId,
}) => {
  const { page } = widget
  await widget.goto("/")
  await widget.commentButton.click()
  // From the hero to near the bottom-right corner, where the toolbar is.
  const hero = (await page.locator(".hero").boundingBox())!
  const view = page.viewportSize()!
  await page.mouse.move(hero.x + 10, hero.y + 10)
  await page.mouse.down()
  await page.mouse.move(hero.x + 30, hero.y + 30, { steps: 2 })
  await page.mouse.move(view.width - 120, view.height - 120, { steps: 6 })
  await page.mouse.up()
  await expect(widget.composer).toBeVisible()
  await widget.post(`The whole page ${Date.now()}`)

  const [comment] = await pageComments(projectId, "/")
  expect(comment!.anchor.region, JSON.stringify(comment!.anchor)).toBeDefined()
  const anchor = JSON.stringify(comment!.anchor)
  for (const words of [
    EN.toolbar,
    EN.addComment,
    EN.cancelAdding,
    EN.pickElement,
    EN.comments,
    EN.searchComments,
    EN.claim,
  ])
    expect(anchor).not.toContain(words)
})
