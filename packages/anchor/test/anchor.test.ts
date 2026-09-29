import { beforeEach, describe, expect, it } from "vitest"

import {
  buildCssSelector,
  buildPath,
  captureAnchor,
  elementText,
  isStableClass,
  isStableId,
  pickTarget,
  resolveAnchor,
  textSimilarity,
} from "../src"

describe("stability heuristics", () => {
  it.each([
    ["btn-primary", true],
    ["card__title", true],
    ["pricing-card", true],
    ["nav", true],
    ["item-3", true],
    ["Button_root__a1B2c", false],
    ["_root_1x2y3", false],
    ["css-1q2w3e", false],
    ["sc-bdVaJa", false],
    ["mt-4", false],
    ["md:flex", false],
    ["w-[32px]", false],
    ["flex", false],
    ["is-active", false],
    ["x7Hk2p9", false],
  ])("class %s stable=%s", (name, stable) => {
    expect(isStableClass(name)).toBe(stable)
  })

  it.each([
    ["email", true],
    ["main-nav", true],
    [":r1:", false],
    ["radix-:r3:-trigger", false],
    ["headlessui-menu-button-12", false],
    ["3f2b8c1e-1234-4abc-9def-000000000000", false],
    ["field-1234", false],
  ])("id %s stable=%s", (id, stable) => {
    expect(isStableId(id)).toBe(stable)
  })
})

describe("text", () => {
  it("normalizes element text and includes alt text", () => {
    document.body.innerHTML = `<button>  Buy <img alt="cart"> <b>now</b>
      <script>ignored()</script></button>`
    expect(elementText(document.querySelector("button")!)).toBe("Buy cart now")
  })

  it("scores similarity", () => {
    expect(textSimilarity("Buy now", "Buy now")).toBe(1)
    expect(textSimilarity("Buy now", "buy NOW")).toBe(1)
    expect(textSimilarity("Buy now", "Buy it now")).toBeGreaterThan(0.5)
    expect(textSimilarity("Buy now", "Contact sales")).toBeLessThan(0.2)
  })
})

describe("selectors", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main>
        <ul class="plans">
          <li class="plan"><button class="btn">Choose</button></li>
          <li class="plan"><button class="btn" data-testid="pro">Choose</button></li>
        </ul>
        <form id="signup"><input name="email"><button>Go</button></form>
        <div class="css-9x8y7z"><span>hi</span></div>
      </main>`
  })

  it("uses test ids and stable ids", () => {
    const pro = document.querySelector('[data-testid="pro"]')!
    expect(buildCssSelector(pro)).toBe('button[data-testid="pro"]')
    const email = document.querySelector("input")!
    expect(buildCssSelector(email)).toBe('input[name="email"]')
  })

  it("disambiguates siblings with nth-of-type", () => {
    const first = document.querySelector("button.btn")!
    const selector = buildCssSelector(first)!
    expect(document.querySelectorAll(selector)).toHaveLength(1)
    expect(document.querySelector(selector)).toBe(first)
  })

  it("builds a structural path from the nearest stable id", () => {
    const go = document.querySelector("#signup > button")!
    expect(buildPath(go)).toBe("#signup > button")
    const span = document.querySelector("span")!
    expect(document.querySelector(buildPath(span))).toBe(span)
  })

  it("ignores attributes by prefix", () => {
    const pro = document.querySelector('[data-testid="pro"]')!
    const selector = buildCssSelector(pro, {
      ignoreAttributePrefixes: ["data-testid"],
    })
    expect(selector).not.toContain("data-testid")
  })
})

describe("pickTarget", () => {
  it("climbs to the interactive control from icons and spans", () => {
    document.body.innerHTML = `<button id="b"><svg><path d="M0 0"/></svg><span>Save</span></button><p><strong>bold</strong> text</p>`
    expect(pickTarget(document.querySelector("path")!).id).toBe("b")
    expect(pickTarget(document.querySelector("span")!).id).toBe("b")
    expect(pickTarget(document.querySelector("strong")!).tagName).toBe("P")
  })
})

describe("capture and resolve", () => {
  it("round-trips on an unchanged DOM", () => {
    document.body.innerHTML = `<main><h1>Title</h1><p class="lead">Hello world</p></main>`
    const el = document.querySelector("p")!
    const anchor = captureAnchor(el)
    expect(anchor).toMatchObject({
      v: 1,
      tag: "p",
      text: "Hello world",
      classes: ["lead"],
    })
    const result = resolveAnchor(anchor, document)
    expect(result.element).toBe(el)
    expect(result.confidence).not.toBe("lost")
  })

  it("follows a list item after reordering", () => {
    document.body.innerHTML = `<ul class="todo"><li class="item">A task</li><li class="item">B task</li><li class="item">C task</li></ul>`
    const anchor = captureAnchor(document.querySelectorAll("li")[1]!)
    document.body.innerHTML = `<ul class="todo"><li class="item">C task</li><li class="item">A task</li><li class="item">B task</li></ul>`
    expect(resolveAnchor(anchor, document).element?.textContent).toBe("B task")
  })

  it("reports lost instead of guessing when the item is deleted", () => {
    document.body.innerHTML = `<ul class="todo"><li class="item">Write docs</li><li class="item">Fix login bug</li><li class="item">Plan launch</li></ul>`
    const anchor = captureAnchor(document.querySelectorAll("li")[1]!)
    document.body.innerHTML = `<ul class="todo"><li class="item">Write docs</li><li class="item">Plan launch</li></ul>`
    const result = resolveAnchor(anchor, document)
    expect(result.element).toBeNull()
    expect(result.confidence).toBe("lost")
  })

  it("never matches ignored elements", () => {
    document.body.innerHTML = `<div id="nuni-root"><button>Comment</button></div><button>Comment</button>`
    const target = document.querySelectorAll("button")[1]!
    const anchor = captureAnchor(target)
    target.remove()
    const result = resolveAnchor(anchor, document, {
      isIgnored: (el) => Boolean(el.closest("#nuni-root")),
    })
    expect(result.element).toBeNull()
  })

  it("stores the click offset inside the element", () => {
    document.body.innerHTML = `<div>box</div>`
    const anchor = captureAnchor(document.querySelector("div")!, { x: 0, y: 0 })
    expect(anchor.offset.x).toBeGreaterThanOrEqual(0)
    expect(anchor.offset.x).toBeLessThanOrEqual(1)
  })
})

describe("masked areas", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section class="account">
        <h2>Your account</h2>
        <p data-nuni-mask title="Card ending 4242">Balance: $1,234</p>
        <div data-nuni-mask><button id="secret" aria-label="Pay $1,234">Pay</button></div>
        <button id="pay">Pay now</button>
      </section>`
  })

  it("never reads text inside data-nuni-mask", () => {
    const section = document.querySelector("section")!
    expect(elementText(section)).toBe("Your account Pay now")
    expect(elementText(document.querySelector("[data-nuni-mask]")!)).toBe("")
    expect(elementText(document.getElementById("secret")!)).toBe("")
  })

  it("keeps masked text and labels out of the anchor, and still resolves", () => {
    const pay = document.getElementById("pay")!
    const anchor = captureAnchor(pay)
    expect(JSON.stringify(anchor)).not.toContain("1,234")
    expect(anchor.ancestors[0]?.text).toBe("Your account Pay now")

    const secret = document.getElementById("secret")!
    const masked = captureAnchor(secret)
    expect(masked.text).toBe("")
    expect(masked.attrs).toEqual({})
    expect(JSON.stringify(masked)).not.toContain("1,234")
    expect(resolveAnchor(masked, document).element).toBe(secret)
  })
})
