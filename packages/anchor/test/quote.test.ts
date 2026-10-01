import { beforeEach, describe, expect, it } from "vitest"

import {
  captureAnchor,
  captureArea,
  captureSelection,
  findQuote,
  resolveAnchor,
} from "../src"
import { captureQuote, quoteContainer, textMap, textOffset } from "../src/quote"

/** A Range over the nth copy of `words` inside `el`. */
function select(el: Element, words: string, nth = 0): Range {
  const map = textMap(el)
  let at = -1
  for (let i = 0; i <= nth; i++) at = map.text.indexOf(words, at + 1)
  if (at < 0) throw new Error(`"${words}" not in "${map.text}"`)
  const range = document.createRange()
  const start = map.nodes[map.node[at]!]!
  const end = map.nodes[map.node[at + words.length - 1]!]!
  range.setStart(start, map.offset[at]!)
  range.setEnd(end, map.offset[at + words.length - 1]! + 1)
  return range
}

const text = (range: Range | null | undefined) =>
  range?.toString().replace(/\s+/g, " ").trim()

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("text map", () => {
  it("collapses whitespace and breaks words at block edges", () => {
    document.body.innerHTML = `<div id="a">
      <h2>Plans</h2><p>Pay   <strong>monthly</strong>
      or yearly.</p><ul><li>One</li><li>Two</li></ul><script>x()</script></div>`
    const map = textMap(document.getElementById("a")!)
    expect(map.text).toBe("Plans Pay monthly or yearly. One Two")
  })

  it("leaves out masked areas", () => {
    document.body.innerHTML = `<p id="a">Card <span data-nuni-mask>4242 4242</span> ends here</p>`
    expect(textMap(document.getElementById("a")!).text).toBe("Card ends here")
  })

  it("maps DOM positions to text offsets and back", () => {
    document.body.innerHTML = `<p id="a">Pay <em>monthly</em> or yearly</p>`
    const p = document.getElementById("a")!
    const range = select(p, "monthly or")
    const map = textMap(p)
    expect(textOffset(map, range.startContainer, range.startOffset)).toBe(4)
    expect(textOffset(map, range.endContainer, range.endOffset)).toBe(14)
    expect(text(range)).toBe("monthly or")
  })
})

describe("capturing a selection", () => {
  it("anchors to the paragraph, out of inline formatting", () => {
    document.body.innerHTML = `<article><p id="a">The <strong>quick brown</strong> fox jumps.</p></article>`
    const p = document.getElementById("a")!
    const range = select(p, "quick brown")
    expect(quoteContainer(range)).toBe(p)
    const captured = captureSelection(range)!
    expect(captured.element).toBe(p)
    expect(captured.anchor.quote).toEqual({
      exact: "quick brown",
      prefix: "The ",
      suffix: " fox jumps.",
    })
  })

  it("trims the selection and keeps context short", () => {
    const long = "word ".repeat(30)
    document.body.innerHTML = `<p id="a">${long}target words ${long}</p>`
    const p = document.getElementById("a")!
    const range = select(p, " target words ")
    const quote = captureQuote(range, p)!
    expect(quote.exact).toBe("target words")
    expect(quote.prefix.length).toBe(32)
    expect(quote.suffix.length).toBe(32)
  })

  it("returns null for a selection with no text", () => {
    document.body.innerHTML = `<p id="a">   </p>`
    const range = document.createRange()
    range.selectNodeContents(document.getElementById("a")!)
    expect(captureSelection(range)).toBeNull()
  })
})

describe("finding a quote again", () => {
  it("tells repeated words apart by their context", () => {
    document.body.innerHTML = `<p id="a">Save now. You can save later. Or save never.</p>`
    const p = document.getElementById("a")!
    const offsetOf = (nth: number) => {
      const hit = findQuote(p, captureQuote(select(p, "save", nth), p)!)!
      expect(hit.exact).toBe(true)
      return textOffset(
        textMap(p),
        hit.range.startContainer,
        hit.range.startOffset
      )
    }
    expect(offsetOf(0)).toBe(18)
    expect(offsetOf(1)).toBe(33)
  })

  it("follows the words when text around them is edited", () => {
    document.body.innerHTML = `<p id="a">Our plans start at $10 per month for small teams.</p>`
    const p = document.getElementById("a")!
    const anchor = captureSelection(select(p, "$10 per month"))!.anchor
    p.innerHTML = `Pricing: all plans now start at <b>$10 per month</b> for teams of any size.`
    const result = resolveAnchor(anchor)
    expect(result.element).toBe(p)
    expect(text(result.range)).toBe("$10 per month")
  })

  it("finds edited words as an approximate match", () => {
    document.body.innerHTML = `<p id="a">Click the green button to continue with checkout.</p>`
    const p = document.getElementById("a")!
    const anchor = captureSelection(
      select(p, "the green button to continue")
    )!.anchor
    p.textContent = "Click the blue button to continue with checkout."
    const result = resolveAnchor(anchor)
    expect(result.element).toBe(p)
    expect(text(result.range)).toBe("the blue button to continue")
    expect(result.confidence).toBe("low")
  })

  it("follows a sentence that moved to the next paragraph", () => {
    document.body.innerHTML = `<section><p id="a">First point. Ship the docs by Friday.</p><p id="b">Second point.</p></section>`
    const a = document.getElementById("a")!
    const anchor = captureSelection(
      select(a, "Ship the docs by Friday.")
    )!.anchor
    a.textContent = "First point."
    document.getElementById("b")!.textContent =
      "Ship the docs by Friday. Second point."
    const result = resolveAnchor(anchor)
    expect(text(result.range)).toBe("Ship the docs by Friday.")
    expect(result.range!.startContainer.parentElement!.id).toBe("b")
  })

  it("leaves an approximate pin on the element when the words are gone", () => {
    document.body.innerHTML = `<h1>Docs</h1><p id="a">Install with npm, then run the setup command.</p>`
    const p = document.getElementById("a")!
    const anchor = captureSelection(select(p, "run the setup command"))!.anchor
    p.textContent = "Install with npm. Configuration happens automatically."
    const result = resolveAnchor(anchor)
    expect(result.range).toBeUndefined()
    expect(result.confidence).not.toBe("exact")
    expect(result.confidence).not.toBe("high")
  })

  it("prefers the paragraph that still holds the words", () => {
    document.body.innerHTML = `<main>${["Alpha", "Beta", "Gamma"]
      .map((w) => `<p class="note">${w} notes about the release plan.</p>`)
      .join("")}</main>`
    const beta = document.querySelectorAll("p")[1]!
    beta.textContent = "Beta notes about the release plan, with a deadline."
    const anchor = captureSelection(select(beta, "with a deadline"))!.anchor
    // The list re-renders in another order and the text is edited.
    document.querySelector("main")!.innerHTML = [
      "Gamma notes about the release plan.",
      "Alpha notes about the release plan.",
      "Beta notes, release plan moved, with a deadline.",
    ]
      .map((t) => `<p class="note">${t}</p>`)
      .join("")
    const result = resolveAnchor(anchor)
    expect(result.element?.textContent).toContain("Beta")
    expect(text(result.range)).toBe("with a deadline")
  })
})

describe("area comments", () => {
  it("stores the box as fractions of the element", () => {
    document.body.innerHTML = `<div id="a">Chart</div>`
    const el = document.getElementById("a")!
    el.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 50,
        width: 400,
        height: 200,
        right: 500,
        bottom: 250,
        x: 100,
        y: 50,
      }) as DOMRect
    const anchor = captureArea(el, {
      left: 200,
      top: 100,
      width: 100,
      height: 50,
    })
    expect(anchor.region).toEqual({ x: 0.25, y: 0.25, w: 0.25, h: 0.25 })
    expect(captureAnchor(el).region).toBeUndefined()
  })
})
