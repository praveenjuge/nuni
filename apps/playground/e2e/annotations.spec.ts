import { expect, test, type Locator, type Page } from "@playwright/test"

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
function projectId() {
  let id = "nuni_"
  for (let i = 0; i < 22; i++) id += ALPHABET[Math.floor(Math.random() * 58)]
  return id
}

const root = (page: Page) => page.locator("#nuni-root")
const composer = (page: Page) => root(page).locator('[data-card="composer"]')
const thread = (page: Page) => root(page).locator('[data-card="thread"]')

/** Select the words inside an element, as a person dragging over them. */
async function selectWords(target: Locator, words: string) {
  await target.evaluate((el, words) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n as Text
      const at = text.data.indexOf(words)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + words.length)
      const selection = getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
    throw new Error(`"${words}" not found`)
  }, words)
}

/** Where the words are on screen. */
async function wordsBox(target: Locator, words: string) {
  return target.evaluate((el, words) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n as Text
      const at = text.data.indexOf(words)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + words.length)
      const r = range.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    throw new Error(`"${words}" not found`)
  }, words)
}

async function post(page: Page, body: string, name?: string) {
  if (name) await composer(page).getByPlaceholder("Your name").fill(name)
  await composer(page).getByPlaceholder("Leave a comment").fill(body)
  await composer(page).getByRole("button", { name: "Post" }).click()
  await expect(root(page).locator(".toast")).toHaveText("Comment added")
}

function near(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  slack = 4
) {
  return (
    Math.abs(a.x - b.x) <= slack &&
    Math.abs(a.y - b.y) <= slack &&
    Math.abs(a.x + a.width - (b.x + b.width)) <= slack &&
    Math.abs(a.y + a.height - (b.y + b.height)) <= slack
  )
}

test("comments on selected text find the same words after a reload", async ({
  page,
}) => {
  const project = projectId()
  await page.goto(`/?project=${project}`)
  await expect(root(page).locator(".toolbar")).toBeVisible()

  // Select words: a Comment button shows under them.
  const lead = page.locator(".lead")
  await selectWords(lead, "ship your product")
  const button = root(page).getByRole("button", {
    name: "Comment",
    exact: true,
  })
  await expect(button).toBeVisible()
  await button.click()
  await expect(composer(page).locator(".quote")).toHaveText("ship your product")
  await post(page, `Say what it ships ${Date.now()}`, "Sam Tester")

  // The words are marked on the page.
  const lead1 = await wordsBox(lead, "ship your product")
  await expect(root(page).locator(".mark")).toHaveCount(1)
  expect(near((await root(page).locator(".mark").boundingBox())!, lead1)).toBe(
    true
  )

  // The same phrase in the second of three cards, commented with C.
  const card = page.locator(".feature").nth(1)
  await selectWords(card, "your team can focus")
  await page.keyboard.press("c")
  await expect(composer(page).locator(".quote")).toHaveText(
    "your team can focus"
  )
  await post(page, `Which team? ${Date.now()}`)

  await page.reload()
  await expect(root(page).locator(".pin:not(.pin-draft)")).toHaveCount(2)
  await expect(root(page).locator(".mark")).toHaveCount(2)
  const marks = await root(page)
    .locator(".mark")
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      })
    )
  const cardWords = await wordsBox(card, "your team can focus")
  expect(marks.some((m) => near(m, lead1))).toBe(true)
  expect(marks.some((m) => near(m, cardWords))).toBe(true)

  // The thread shows the words.
  await root(page)
    .locator(".toolbar")
    .getByRole("button", { name: /open/ })
    .click()
  await root(page).locator(".panel .item", { hasText: "Which team?" }).click()
  await expect(thread(page).locator(".quote")).toHaveText("your team can focus")
  await expect(root(page).locator(".mark-active")).toHaveCount(1)
})

test("an area dragged while picking is shown again on its element", async ({
  page,
}) => {
  const project = projectId()
  await page.goto(`/?project=${project}`)
  await root(page)
    .locator(".toolbar")
    .getByRole("button", { name: "Add a comment" })
    .click()

  const hero = page.locator(".hero")
  const box = (await hero.boundingBox())!
  const from = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.3 }
  const to = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.7 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 2 })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await expect(root(page).locator(".drag-box")).toBeVisible()
  await page.mouse.up()
  await expect(composer(page)).toBeVisible()
  // The page's links and buttons under the drag were not clicked.
  await expect(page).toHaveURL(new RegExp(`/\\?project=${project}$`))
  const drawn = (await root(page).locator(".area").boundingBox())!
  const expected = {
    x: from.x,
    y: from.y,
    width: to.x - from.x,
    height: to.y - from.y,
  }
  expect(near(drawn, expected, 3)).toBe(true)
  await post(page, `This whole block ${Date.now()}`, "Sam Tester")

  await page.reload()
  await expect(root(page).locator(".pin:not(.pin-draft)")).toHaveCount(1)
  await root(page).locator(".pin:not(.pin-draft)").click()
  await expect(thread(page)).toBeVisible()
  const shown = (await root(page).locator(".area").boundingBox())!
  expect(near(shown, expected, 3)).toBe(true)
})
