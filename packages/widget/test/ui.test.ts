import { afterEach, describe, expect, it, vi } from "vitest"

import { init } from "../src/index"
import type { NuniInstance } from "../src/mount"

const PROJECT = "nuni_JJHAES8DaHHYNVh4JoWWXw"
let instance: NuniInstance | null = null

async function mount() {
  document.body.innerHTML = `<main><h1 id="title">Pricing</h1><p>Plans</p></main>`
  instance = init({ project: PROJECT })
  const host = () => document.getElementById("nuni-root")
  await vi.waitFor(() =>
    expect(host()?.shadowRoot?.querySelector(".toolbar")).toBeTruthy()
  )
  return host()!.shadowRoot!
}

function press(key: string, options: KeyboardEventInit = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, ...options })
  )
}

function type(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  field.value = text
  field.dispatchEvent(new Event("input"))
}

afterEach(() => {
  instance?.destroy()
  instance = null
  document.body.innerHTML = ""
  localStorage.clear()
})

describe("widget", () => {
  it("picks an element with the hotkey and keeps unsent words", async () => {
    const root = await mount()
    press("c")
    expect(root.querySelector(".pick-hint")).toBeTruthy()
    document.getElementById("title")!.click()
    expect(root.querySelector('[data-card="composer"]')).toBeTruthy()
    expect(root.querySelector(".pick-hint")).toBeNull()

    type(root.querySelector('[data-focus-key="name"]')!, "Sam")
    type(root.querySelector('[data-focus-key="body"]')!, "Too small")
    // Any render (here: hiding the pins) rebuilds the card.
    press("C", { shiftKey: true })
    expect(
      root.querySelector<HTMLTextAreaElement>('[data-focus-key="body"]')!.value
    ).toBe("Too small")
    expect(
      root.querySelector<HTMLInputElement>('[data-focus-key="name"]')!.value
    ).toBe("Sam")

    // A press on the page keeps a card with unsent words…
    const outside = () =>
      document
        .getElementById("title")!
        .dispatchEvent(
          new PointerEvent("pointerdown", { isPrimary: true, bubbles: true })
        )
    outside()
    expect(root.querySelector('[data-card="composer"]')).toBeTruthy()
    // …and closes an empty one.
    type(root.querySelector('[data-focus-key="body"]')!, "")
    outside()
    expect(root.querySelector("[data-card]")).toBeNull()
  })

  it("asks for a name before posting, and offers to change a remembered one", async () => {
    const root = await mount()
    const compose = () => {
      press("c")
      document.getElementById("title")!.click()
    }
    compose()
    type(root.querySelector('[data-focus-key="body"]')!, "Too small")
    root
      .querySelector<HTMLFormElement>('[data-card="composer"]')!
      .requestSubmit()
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      "Enter your name"
    )
    press("Escape")

    localStorage.setItem("nuni:name", "Sam")
    instance?.destroy()
    const again = await mount()
    press("c")
    document.getElementById("title")!.click()
    expect(again.querySelector('[data-focus-key="name"]')).toBeNull()
    expect(again.querySelector(".cmp-head .author")?.textContent).toBe("Sam")
    const notYou = [...again.querySelectorAll("button")].find(
      (b) => b.textContent === "Not you?"
    )!
    notYou.click()
    expect(again.querySelector('[data-focus-key="name"]')).toBeTruthy()
  })

  it("cancels picking and closes the card with Escape", async () => {
    const root = await mount()
    press("c")
    press("Escape")
    expect(root.querySelector(".pick-hint")).toBeNull()
    press("c")
    document.getElementById("title")!.click()
    press("Escape")
    expect(root.querySelector("[data-card]")).toBeNull()
  })

  it("opens the comments panel, and Escape closes it", async () => {
    const root = await mount()
    root
      .querySelector<HTMLButtonElement>('[data-focus-key="tb-panel"]')!
      .click()
    expect(root.querySelector(".panel")).toBeTruthy()
    press("Escape")
    expect(root.querySelector(".panel")).toBeNull()
  })
})
