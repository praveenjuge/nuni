import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"
import { build } from "tsdown"

import { scenarios } from "./fixtures"

const here = dirname(fileURLToPath(import.meta.url))
const MIN_CORRECT_RATE = 0.95
const MAX_WRONG = 1

interface Result {
  name: string
  category: string
  expect: "found" | "lost"
  outcome: "correct" | "lost" | "wrong"
  confidence: string
  score: number
}

let bundle = ""

test.beforeAll(async () => {
  const outDir = join(here, ".bundle")
  await build({
    entry: { engine: join(here, "entry.ts") },
    outDir,
    format: "iife",
    platform: "browser",
    dts: false,
    logLevel: "silent",
    noExternal: [/.*/],
  })
  const { readFileSync, readdirSync } = await import("node:fs")
  const file = readdirSync(outDir).find((f) => f.startsWith("engine"))!
  bundle = readFileSync(join(outDir, file), "utf8")
})

test("pin reliability benchmark", async ({ page }) => {
  test.setTimeout(120_000)
  const results: Result[] = []

  for (const s of scenarios) {
    const [bw, bh] = s.viewport?.before ?? [1280, 800]
    await page.setViewportSize({ width: bw, height: bh })
    await page.setContent(s.before)
    await page.addScriptTag({ content: bundle })

    const anchor = await page.evaluate(
      ({ scrollBefore, scrollContainer }) => {
        if (scrollContainer) {
          document.querySelector(scrollContainer.selector)!.scrollTop = scrollContainer.top
        }
        if (scrollBefore) window.scrollTo(0, scrollBefore)
        const el = document.querySelector("[data-bench-target]")!
        el.scrollIntoView({ block: "center" })
        const r = el.getBoundingClientRect()
        const api = (window as never as { NuniAnchor: typeof import("../src") }).NuniAnchor
        return api.captureAnchor(
          el,
          { x: r.left + r.width / 2, y: r.top + r.height / 2 },
          { ignoreAttributePrefixes: ["data-bench"] }
        )
      },
      { scrollBefore: s.scrollBefore, scrollContainer: s.scrollContainer }
    )

    const [aw, ah] = s.viewport?.after ?? [1280, 800]
    await page.setViewportSize({ width: aw, height: ah })
    await page.setContent(s.after)
    await page.addScriptTag({ content: bundle })

    const resolved = await page.evaluate(
      ({ anchor, scrollAfter }) => {
        window.scrollTo(0, scrollAfter ?? 0)
        const api = (window as never as { NuniAnchor: typeof import("../src") }).NuniAnchor
        const result = api.resolveAnchor(anchor, document, {
          ignoreAttributePrefixes: ["data-bench"],
        })
        return {
          found: Boolean(result.element),
          correct: Boolean(result.element?.hasAttribute("data-bench-target")),
          confidence: result.confidence,
          score: Math.round(result.score * 1000) / 1000,
          tag: result.element?.tagName.toLowerCase() ?? null,
          text: result.element?.textContent?.trim().slice(0, 40) ?? null,
        }
      },
      { anchor, scrollAfter: s.scrollAfter }
    )

    let outcome: Result["outcome"]
    if (s.expect === "found") {
      outcome = resolved.correct ? "correct" : resolved.found ? "wrong" : "lost"
    } else {
      outcome = resolved.found ? "wrong" : "correct"
    }
    results.push({
      name: s.name,
      category: s.category,
      expect: s.expect,
      outcome,
      confidence: resolved.confidence,
      score: resolved.score,
    })
    const icon = outcome === "correct" ? "✓" : outcome === "lost" ? "?" : "✗"
    console.log(
      `${icon} ${s.name.padEnd(42)} ${outcome.padEnd(8)} ${resolved.confidence.padEnd(6)} ${resolved.score}` +
        (outcome === "wrong" ? `  -> <${resolved.tag}> "${resolved.text}"` : "")
    )
  }

  const found = results.filter((r) => r.expect === "found")
  const correct = results.filter((r) => r.outcome === "correct").length
  const correctFound = found.filter((r) => r.outcome === "correct").length
  const wrong = results.filter((r) => r.outcome === "wrong").length
  const rate = correctFound / found.length

  console.log(
    `\nCorrect: ${correct}/${results.length}  (found-scenarios ${(rate * 100).toFixed(1)}%)  Wrong: ${wrong}`
  )
  writeFileSync(
    join(here, "..", "bench-report.json"),
    JSON.stringify({ rate, wrong, results }, null, 2)
  )

  expect(rate, "re-anchoring success rate").toBeGreaterThanOrEqual(MIN_CORRECT_RATE)
  expect(wrong, "pins placed on the wrong element").toBeLessThanOrEqual(MAX_WRONG)
})
