import { generateProjectId as projectId } from "@nuni/shared"
import { expect, test } from "@playwright/test"

for (const nested of [false, true]) {
  test(`comments jump to their exact pin in ${nested ? "a scroll container" : "the page"}`, async ({
    page,
  }) => {
    const project = projectId()
    await page.addInitScript((nested) => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style")
        style.textContent =
          ".hero { height: 3000px; position: relative; }" +
          (nested ? "main { height: 600px; overflow: auto; }" : "")
        document.head.append(style)
      })
    }, nested)
    await page.goto(`/?project=${project}`)
    const root = page.locator("#nuni-root")
    await expect(root.locator(".toolbar")).toBeVisible()
    const scrollTo = async (top: number) =>
      page.evaluate(
        ({ nested, top }) => {
          if (nested) document.querySelector("main")!.scrollTo(0, top)
          else window.scrollTo(0, top)
        },
        { nested, top }
      )
    await scrollTo(2400)
    await root
      .getByRole("button", { name: "Add a comment", exact: true })
      .click()
    await page.mouse.click(400, 450)
    const composer = root.locator('[data-card="composer"]')
    await composer.getByPlaceholder("Your name").fill("Jump Tester")
    await composer
      .getByPlaceholder("Leave a comment")
      .fill("Review this exact spot")
    await composer.getByRole("button", { name: "Post", exact: true }).click()
    await expect(root.locator(".toast")).toHaveText("Comment added")
    await scrollTo(0)
    await root.locator(".toolbar").getByRole("button", { name: /open/ }).click()
    await root
      .locator(".panel .item", { hasText: "Review this exact spot" })
      .click()
    const expectPin = async () => {
      await expect(root.locator('[data-card="thread"]')).toContainText(
        "Review this exact spot"
      )
      await expect
        .poll(async () => {
          const box = await root
            .locator('.pin[data-active="true"]')
            .boundingBox()
          return Boolean(box && box.y > 40 && box.y + box.height < 680)
        })
        .toBe(true)
    }
    await expectPin()
    // The dashboard's jump URL uses the same navigation path on a fresh page.
    const id = await page.evaluate(async (project) => {
      const res = await fetch("http://127.0.0.1:3310/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "comments:listForPage",
          args: { publicId: project, path: "/" },
          format: "json",
        }),
      })
      const data = (await res.json()) as { value: { _id: string }[] }
      return data.value[0]!._id
    }, project)
    await page.goto(`/?project=${project}&nuni=${id}`)
    await expectPin()
    await page.screenshot({
      path: `test-results/jump-${nested ? "container" : "page"}.png`,
    })
  })
}
