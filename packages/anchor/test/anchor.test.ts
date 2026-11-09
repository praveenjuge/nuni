import { WIDGET_ATTRIBUTE, WIDGET_SELECTOR } from "@nuni/shared"
import { beforeEach, describe, expect, it } from "vitest"

import {
  captureAnchor,
  elementText,
  pickTarget,
  resolveAnchor,
  textSimilarity,
} from "../src"
import { buildCssSelector, buildPath } from "../src/selector"
import { isStableClass, isStableId } from "../src/stable"

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

  it("builds selectors from test ids and names that survive reordering", () => {
    const pro = document.querySelector('[data-testid="pro"]')!
    const email = document.querySelector("input")!
    const selectors = [buildCssSelector(pro)!, buildCssSelector(email)!]
    const plans = document.querySelector(".plans")!
    plans.prepend(plans.lastElementChild!)
    const form = document.querySelector("form")!
    form.prepend(form.querySelector("button")!)
    expect(selectors.map((s) => document.querySelectorAll(s).length)).toEqual([
      1, 1,
    ])
    expect(document.querySelector(selectors[0]!)).toBe(pro)
    expect(document.querySelector(selectors[1]!)).toBe(email)
  })

  it("disambiguates siblings with nth-of-type", () => {
    const first = document.querySelector("button.btn")!
    const selector = buildCssSelector(first)!
    expect(document.querySelectorAll(selector)).toHaveLength(1)
    expect(document.querySelector(selector)).toBe(first)
  })

  it("builds a structural path from the nearest stable id", () => {
    const go = document.querySelector("#signup > button")!
    const path = buildPath(go)
    const span = document.querySelector("span")!
    expect(document.querySelector(buildPath(span))).toBe(span)
    // Markup added above the id doesn't break the path.
    document.body.innerHTML = `<div class="layout"><section>${document.body.innerHTML}</section></div>`
    expect(document.querySelector(path)).toBe(
      document.querySelector("#signup > button")
    )
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
    const result = resolveAnchor(anchor)
    expect(result.element).toBe(el)
    expect(result.confidence).not.toBe("lost")
  })

  it("follows a list item after reordering", () => {
    document.body.innerHTML = `<ul class="todo"><li class="item">A task</li><li class="item">B task</li><li class="item">C task</li></ul>`
    const anchor = captureAnchor(document.querySelectorAll("li")[1]!)
    document.body.innerHTML = `<ul class="todo"><li class="item">C task</li><li class="item">A task</li><li class="item">B task</li></ul>`
    expect(resolveAnchor(anchor).element?.textContent).toBe("B task")
  })

  it("reports lost instead of guessing when the item is deleted", () => {
    document.body.innerHTML = `<ul class="todo"><li class="item">Write docs</li><li class="item">Fix login bug</li><li class="item">Plan launch</li></ul>`
    const anchor = captureAnchor(document.querySelectorAll("li")[1]!)
    document.body.innerHTML = `<ul class="todo"><li class="item">Write docs</li><li class="item">Plan launch</li></ul>`
    const result = resolveAnchor(anchor)
    expect(result.element).toBeNull()
    expect(result.confidence).toBe("lost")
  })

  it("never matches ignored elements", () => {
    document.body.innerHTML = `<div id="nuni-root"><button>Comment</button></div><button>Comment</button>`
    const target = document.querySelectorAll("button")[1]!
    const anchor = captureAnchor(target)
    target.remove()
    const result = resolveAnchor(anchor, {
      isIgnored: (el) => Boolean(el.closest("#nuni-root")),
    })
    expect(result.element).toBeNull()
  })

  it("stores the click position as a fraction of the element", () => {
    document.body.innerHTML = `<div>box</div>`
    const el = document.querySelector("div")!
    el.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 200, height: 100 }) as DOMRect
    expect(captureAnchor(el, { x: 150, y: 125 }).offset).toEqual({
      x: 0.25,
      y: 0.75,
    })
    expect(captureAnchor(el).offset).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe("Nuni's own UI and data-nuni test ids", () => {
  it("reads the text of elements a site marks with data-nuni", () => {
    document.body.innerHTML = `<section class="plan" data-nuni="plan-pro"><p>Pro</p><button data-nuni="choose-pro">Choose plan</button></section>`
    const button = document.querySelector("button")!
    const anchor = captureAnchor(button)
    expect(anchor.text).toBe("Choose plan")
    expect(anchor.selectors.testId).toBe("data-nuni=choose-pro")
    expect(anchor.ancestors[0]!.text).toBe("Pro Choose plan")
  })

  it("still finds pins stored when data-nuni elements had no text", () => {
    document.body.innerHTML = `<main><a class="cta" data-nuni="hero-cta" href="/start">Get started</a><a class="cta" href="/demo">Book a demo</a></main>`
    const old = { ...captureAnchor(document.querySelector("a")!), text: "" }
    document.body.innerHTML = `<main><a class="cta" href="/demo">Book a demo</a><a class="cta" data-nuni="hero-cta" href="/start">Start your free trial</a></main>`
    expect(resolveAnchor(old).element?.getAttribute("data-nuni")).toBe(
      "hero-cta"
    )
  })

  it("never reads or matches inside the widget", () => {
    document.body.innerHTML = `<main><p>Docs</p></main><div ${WIDGET_ATTRIBUTE}><p>Docs</p></div>`
    const host = document.querySelector(WIDGET_SELECTOR)!
    host.attachShadow({ mode: "open" }).innerHTML = `<button>Comment</button>`
    expect(elementText(document.body)).toBe("Docs")
    const anchor = captureAnchor(document.querySelector("main p")!)
    document.querySelector("main")!.remove()
    expect(resolveAnchor(anchor).element).toBeNull()
  })
})

describe("masked areas", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section class="account">
        <h2>Your account</h2>
        <p data-nuni-mask title="Card ending 4242">Balance: $1,234</p>
        <div data-nuni-mask><button id="secret" aria-label="Pay $1,234">Pay</button></div>
        <div data-nuni-mask><button aria-label="Refund $1,234">Refund</button></div>
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
    expect(resolveAnchor(masked).element).toBe(secret)
  })

  it("keeps masked labels out of the selectors", () => {
    const refund = document.querySelectorAll("[data-nuni-mask] button")[1]!
    const anchor = captureAnchor(refund)
    expect(JSON.stringify(anchor)).not.toContain("1,234")
    expect(resolveAnchor(anchor).element).toBe(refund)
  })
})

describe("shadow DOM", () => {
  function card(plan: string) {
    const host = document.createElement("plan-card")
    const root = host.attachShadow({ mode: "open" })
    root.innerHTML = `<h3>${plan}</h3><p>${plan} plan</p><button type="button">Choose plan</button>`
    return host
  }

  beforeEach(() => {
    document.body.innerHTML = `<main><section class="grid"></section></main>`
    const grid = document.querySelector(".grid")!
    for (const plan of ["Starter", "Pro", "Team"]) grid.append(card(plan))
  })

  const button = (plan: string) =>
    Array.from(document.querySelectorAll("plan-card"))
      .find((h) => h.shadowRoot!.querySelector("h3")!.textContent === plan)!
      .shadowRoot!.querySelector("button")!

  it("records the host chain and builds selectors inside the shadow root", () => {
    const anchor = captureAnchor(button("Pro"))
    expect(anchor.scope).toHaveLength(1)
    expect(anchor.scope![0]!.kind).toBe("shadow")
    expect(anchor.scope![0]!.host.tag).toBe("plan-card")
    // The host's text is what it shows: its shadow tree.
    expect(anchor.scope![0]!.host.text).toContain("Pro")
    const shadow = button("Pro").getRootNode() as ShadowRoot
    expect(Array.from(shadow.querySelectorAll(anchor.selectors.path))).toEqual([
      button("Pro"),
    ])
  })

  it("finds the element again through its host, and not in another card", () => {
    const anchor = captureAnchor(button("Pro"))
    expect(resolveAnchor(anchor).element).toBe(button("Pro"))

    // A card inserted before: still the Pro card.
    const grid = document.querySelector(".grid")!
    grid.prepend(card("Free"))
    expect(resolveAnchor(anchor).element).toBe(button("Pro"))

    // The Pro card removed: lost, not the same-looking button elsewhere.
    document.querySelectorAll("plan-card").forEach((h) => {
      if (h.shadowRoot!.querySelector("h3")!.textContent === "Pro") h.remove()
    })
    const lost = resolveAnchor(anchor)
    expect(lost.element).toBeNull()
    expect(lost.confidence).toBe("lost")
  })

  it("leaves anchors in the page's own document without a scope", () => {
    document.body.innerHTML = `<button id="buy">Buy</button>`
    expect(captureAnchor(document.getElementById("buy")!).scope).toBeUndefined()
  })
})
