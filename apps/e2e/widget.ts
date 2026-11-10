import { expect, type Locator, type Page } from "@playwright/test"

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The Nuni widget on one page: the only place that knows its DOM. Roles and
 * labels where the widget has them; otherwise the class names and `data-*`
 * attributes it keeps stable.
 */
export class Widget {
  readonly root: Locator
  readonly toolbar: Locator
  /** "Add a comment", or "Cancel adding a comment" while picking. */
  readonly commentButton: Locator
  readonly panelButton: Locator
  readonly hideButton: Locator
  /** The Comment button under selected text. */
  readonly selectionButton: Locator
  readonly pickHint: Locator
  readonly highlightLabel: Locator
  readonly pins: Locator
  readonly activePin: Locator
  readonly composer: Locator
  readonly nameField: Locator
  readonly bodyField: Locator
  readonly newTextField: Locator
  readonly thread: Locator
  readonly replies: Locator
  readonly panel: Locator
  readonly search: Locator
  /** The open tab's list. */
  readonly list: Locator
  readonly items: Locator
  readonly sections: Locator
  readonly toast: Locator
  readonly confirm: Locator

  constructor(
    readonly page: Page,
    readonly project: string
  ) {
    this.root = page.locator("#nuni-root")
    this.toolbar = this.root.getByRole("toolbar")
    this.commentButton = this.toolbar.getByRole("button", {
      name: /^(Add a comment|Cancel adding a comment)$/,
    })
    this.panelButton = this.toolbar.getByRole("button", {
      name: /^Comments on this page: \d+ open$/,
    })
    this.hideButton = this.toolbar.getByRole("button", {
      name: "Hide comments",
    })
    this.selectionButton = this.root.getByRole("button", {
      name: "Comment",
      exact: true,
    })
    this.pickHint = this.root.locator(".pick-hint")
    this.highlightLabel = this.root.locator(".highlight-label")
    this.pins = this.root.locator(".pin:not(.pin-draft)")
    this.activePin = this.root.locator('.pin[data-active="true"]')
    this.composer = this.root.locator('[data-card="composer"]')
    this.nameField = this.composer.getByRole("textbox", { name: "Your name" })
    this.bodyField = this.composer.getByRole("textbox", {
      name: "Comment",
      exact: true,
    })
    this.newTextField = this.root.getByRole("textbox", { name: "New text" })
    this.thread = this.root.locator('[data-card="thread"]')
    this.replies = this.thread.locator(".reply")
    this.panel = this.root.getByRole("dialog", {
      name: "Comments",
      exact: true,
    })
    this.search = this.panel.getByRole("searchbox", {
      name: "Search comments",
    })
    this.list = this.panel.getByRole("tabpanel")
    this.items = this.list.locator(".item")
    this.sections = this.list.locator(".section-label")
    this.toast = this.root.locator(".toast")
    this.confirm = this.root.getByRole("alertdialog")
  }

  /** A playground page for this project; `params` adds options or a `nuni` deep link. */
  async goto(path = "/", params: Record<string, string> = {}) {
    const query = new URLSearchParams({ project: this.project, ...params })
    await this.page.goto(`${path}?${query}`)
    await expect(this.toolbar).toBeVisible()
  }

  async reload() {
    await this.page.reload()
    await expect(this.toolbar).toBeVisible()
  }

  async expectOpenCount(count: number) {
    await expect(this.panelButton).toHaveAccessibleName(
      `Comments on this page: ${count} open`
    )
  }

  pinsWithStatus(status: "open" | "resolved") {
    return this.root.locator(`.pin[data-status=${status}]`)
  }

  /** Pins found on their element with exact or high confidence. */
  get confidentPins() {
    return this.root.locator(
      '.pin[data-confidence="exact"], .pin[data-confidence="high"]'
    )
  }

  /** The open thread's note that its element is gone from the page. */
  get lostNote() {
    return this.thread.locator(".lost")
  }

  /** The selected words a comment box or thread quotes. */
  quote(card: Locator) {
    return card.locator(".quote")
  }

  /** A suggested edit's old and new words in a card or panel item. */
  suggestion(card: Locator) {
    const edit = card.locator(".suggest")
    return { before: edit.locator("del"), after: edit.locator("ins") }
  }

  get threadBody() {
    return this.thread.locator(".comment-body")
  }

  /** Images attached to the open thread's comment. */
  get threadImages() {
    return this.thread.locator(".images img")
  }

  /** The owner-only screenshot in the open thread. */
  get threadScreenshot() {
    return this.thread.locator(".shot img")
  }

  /** Images waiting in the comment box. */
  get composerImages() {
    return this.composer.locator(".cmp-thumb")
  }

  /** The reactions under the open thread's comment (not its replies). */
  get commentReactions() {
    return this.thread.locator(".card-body .reactions").first()
  }

  ownerBadge(reply: Locator) {
    return reply.locator(".badge-owner")
  }

  /** "old → new" on a panel item for a suggested edit. */
  itemSuggestion(item: Locator) {
    return item.locator(".item-suggest")
  }

  tab(name: string | RegExp) {
    return this.panel.getByRole("tab", { name })
  }

  item(text: string) {
    return this.items.filter({ hasText: text })
  }

  /** Pick `target` and wait for the comment box. */
  async startComment(target: Locator) {
    await this.commentButton.click()
    await target.click()
    await expect(this.composer).toBeVisible()
  }

  /**
   * Post the open comment box. The widget asks for a name only until this
   * browser has posted one, so `name` is used only when it asks.
   */
  async post(body: string, { name = "Val Visitor" } = {}) {
    if (await this.nameField.isVisible()) await this.nameField.fill(name)
    await this.bodyField.fill(body)
    await this.composer.getByRole("button", { name: "Post" }).click()
    await expect(this.toast).toHaveText("Comment added")
  }

  async comment(target: Locator, body: string, options?: { name?: string }) {
    await this.startComment(target)
    await this.post(body, options)
  }

  async openPanel() {
    await this.panelButton.click()
    await expect(this.panel).toBeVisible()
  }

  /** Open a comment from the panel (opening the panel first). */
  async openThread(body: string) {
    await this.openPanel()
    await this.item(body).click()
    await expect(this.thread).toContainText(body)
  }

  async reply(body: string, { name }: { name?: string } = {}) {
    const form = this.thread.locator(".reply-form")
    if (name) await form.getByRole("textbox", { name: "Your name" }).fill(name)
    await form.getByRole("textbox", { name: "Reply" }).fill(body)
    await form.getByRole("button", { name: "Send reply" }).click()
  }

  /** Delete the open thread's comment, confirming in the widget's dialog. */
  async deleteComment() {
    await this.thread.getByRole("button", { name: "Delete" }).click()
    await this.confirm.getByRole("button", { name: "Delete" }).click()
  }

  /** Select the words inside `target`, as a person dragging over them. */
  async selectWords(target: Locator, words: string) {
    await wordRects(target, words, true)
  }

  /** Where the words inside `target` are on screen. */
  wordBoxes(target: Locator, words: string) {
    return wordRects(target, words, false)
  }

  /** Marks under commented words; `active` for the open comment's. */
  markBoxes({ active = false } = {}) {
    return this.boxesOf(active ? ".mark-active" : ".mark")
  }

  /** The dragged area while picking, and an area comment's box. */
  areaBoxes({ dragging = false } = {}) {
    return this.boxesOf(dragging ? ".drag-box" : ".area")
  }

  toolbarBox() {
    return this.boxesOf(".toolbar").then((boxes) => boxes[0]!)
  }

  /**
   * Overlay boxes read in one step: the widget redraws them on every layout
   * frame, so an element found a moment ago may already be gone.
   */
  private boxesOf(selector: string): Promise<Box[]> {
    return this.root.evaluate(
      (host, selector) =>
        Array.from(host.shadowRoot!.querySelectorAll(selector), (el) => {
          const r = el.getBoundingClientRect()
          return { x: r.x, y: r.y, width: r.width, height: r.height }
        }),
      selector
    )
  }

  /** A theme color (like `--n-danger`) as the browser computes it: `rgb(…)`. */
  themeColor(variable: string) {
    return this.root.evaluate((host, variable) => {
      const probe = document.createElement("div")
      probe.style.color = `var(${variable})`
      host.shadowRoot!.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    }, variable)
  }

  /** The secret that lets this browser edit and delete its own comments. */
  authorSecret() {
    return this.page.evaluate(() => localStorage.getItem("nuni:author-secret"))
  }
}

function wordRects(target: Locator, words: string, select: boolean) {
  return target.evaluate(
    (el, { words, select }) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n as Text
        const at = text.data.indexOf(words)
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(text, at)
        range.setEnd(text, at + words.length)
        if (select) {
          getSelection()!.removeAllRanges()
          getSelection()!.addRange(range)
        }
        return Array.from(range.getClientRects(), (r) => ({
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        }))
      }
      throw new Error(`"${words}" not found`)
    },
    { words, select }
  )
}

/** Each edge of `a` within `slack` pixels of `b`'s. */
export function near(a: Box, b: Box, slack = 4) {
  return (
    Math.abs(a.x - b.x) <= slack &&
    Math.abs(a.y - b.y) <= slack &&
    Math.abs(a.x + a.width - (b.x + b.width)) <= slack &&
    Math.abs(a.y + a.height - (b.y + b.height)) <= slack
  )
}
