import type { NuniOptions } from "@nuniapp/widget"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { Nuni } from "../src"

const widget = vi.hoisted(() => ({
  init: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock("@nuniapp/widget", () => ({
  init: (options: NuniOptions) => {
    widget.init(options)
    return { destroy: widget.destroy }
  },
}))

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root

beforeEach(() => {
  widget.init.mockClear()
  widget.destroy.mockClear()
  root = createRoot(document.createElement("div"))
})

afterEach(() => act(() => root.unmount()))

const render = (props: NuniOptions) =>
  act(() => root.render(<Nuni {...props} />))

it("passes every option to the widget, including ones added later", async () => {
  const getPageKey = (url: URL) => url.pathname
  // An option the component has never heard of reaches init too.
  const future = { someFutureOption: "on" } as Partial<NuniOptions>
  await render({
    project: "nuni_test",
    images: false,
    hotkey: false,
    capture: { screenshot: false },
    messages: { comment: "Feedback" },
    getPageKey,
    ...future,
  } as NuniOptions)
  expect(widget.init).toHaveBeenCalledTimes(1)
  expect(widget.init).toHaveBeenCalledWith({
    project: "nuni_test",
    images: false,
    hotkey: false,
    capture: { screenshot: false },
    messages: { comment: "Feedback" },
    getPageKey,
    someFutureOption: "on",
  })
})

it("remounts only when an option's contents change", async () => {
  await render({ project: "nuni_test", capture: { dom: false } })
  // A new inline object with the same contents: same widget.
  await render({ project: "nuni_test", capture: { dom: false } })
  expect(widget.init).toHaveBeenCalledTimes(1)

  await render({ project: "nuni_test", images: false, capture: { dom: false } })
  expect(widget.destroy).toHaveBeenCalledTimes(1)
  expect(widget.init).toHaveBeenCalledTimes(2)
  expect(widget.init).toHaveBeenLastCalledWith(
    expect.objectContaining({ images: false })
  )
})
