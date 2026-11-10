import { expect, test } from "../../fixtures"

/** WCAG relative luminance of an `rgb(…)` color. */
function luminance(color: string) {
  const [r, g, b] = color
    .match(/\d+(\.\d+)?/g)!
    .slice(0, 3)
    .map((c) => {
      const v = Number(c) / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

test("position, color, theme, label, hotkey and locale options", async ({
  widget,
}) => {
  await widget.goto("/", {
    position: "top-left",
    accentColor: "#facc15",
    theme: "dark",
    label: "Feedback",
    hotkey: "f",
    locale: "de",
  })
  const box = await widget.toolbarBox()
  expect(box.x).toBeLessThan(40)
  expect(box.y).toBeLessThan(40)
  await expect(widget.toolbar).toContainText("Feedback")
  await expect(widget.root).toHaveAttribute("data-theme", "dark")
  const accent = await widget.themeColor("--n-accent")
  expect(accent).toBe("rgb(250, 204, 21)")
  // Text on the accent stays readable, and the dark theme is dark.
  expect(
    contrast(accent, await widget.themeColor("--n-accent-fg"))
  ).toBeGreaterThanOrEqual(4.5)
  expect(luminance(await widget.themeColor("--n-bg"))).toBeLessThan(0.05)

  // The hotkey is F now; C does nothing.
  const add = widget.commentButton
  await widget.page.keyboard.press("c")
  await expect(add).toHaveAttribute("aria-pressed", "false")
  await widget.page.keyboard.press("f")
  await expect(add).toHaveAttribute("aria-pressed", "true")
  await expect(add).toHaveAttribute("title", "Add a comment (F)")
  await widget.page.keyboard.press("Escape")
  await expect(add).toHaveAttribute("aria-pressed", "false")
})
