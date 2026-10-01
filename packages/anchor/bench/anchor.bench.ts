import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test, type Page } from "@playwright/test"
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

/** srcdoc iframes load after setContent returns. */
async function framesLoaded(page: Page) {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("iframe")).every(
      (f) => f.contentDocument?.readyState === "complete"
    )
  )
}

test.beforeAll(async () => {
  const outDir = join(here, ".bundle")
  await build({
    entry: { engine: join(here, "entry.ts") },
    outDir,
    format: "iife",
    platform: "browser",
    dts: false,
    logLevel: "silent",
    deps: { alwaysBundle: [/.*/], onlyBundle: false },
  })
  const { readFileSync, readdirSync } = await import("node:fs")
  const file = readdirSync(outDir).find((f) => f.startsWith("engine"))!
  bundle = readFileSync(join(outDir, file), "utf8")
})

const report: Record<string, unknown> = {}

test("pin reliability benchmark", async ({ page }) => {
  test.setTimeout(120_000)
  const results: Result[] = []

  for (const s of scenarios) {
    const [bw, bh] = s.viewport?.before ?? [1280, 800]
    await page.setViewportSize({ width: bw, height: bh })
    await page.setContent(s.before)
    await framesLoaded(page)
    await page.addScriptTag({ content: bundle })

    const anchor = await page.evaluate(
      ({ scrollBefore, scrollContainer }) => {
        if (scrollContainer) {
          document.querySelector(scrollContainer.selector)!.scrollTop =
            scrollContainer.top
        }
        if (scrollBefore) window.scrollTo(0, scrollBefore)
        // The target may be inside shadow roots or same-origin iframes.
        const find = (root: Document | ShadowRoot): Element | null => {
          const hit = root.querySelector("[data-bench-target]")
          if (hit) return hit
          for (const el of Array.from(root.querySelectorAll("*"))) {
            const inner = el.shadowRoot
              ? find(el.shadowRoot)
              : el.tagName === "IFRAME" &&
                  (el as HTMLIFrameElement).contentDocument
                ? find((el as HTMLIFrameElement).contentDocument!)
                : null
            if (inner) return inner
          }
          return null
        }
        const el = find(document)!
        el.scrollIntoView({ block: "center" })
        const r = el.getBoundingClientRect()
        const api = (window as never as { NuniAnchor: typeof import("../src") })
          .NuniAnchor
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
    await framesLoaded(page)
    await page.addScriptTag({ content: bundle })

    const resolved = await page.evaluate(
      ({ anchor, scrollAfter }) => {
        window.scrollTo(0, scrollAfter ?? 0)
        const api = (window as never as { NuniAnchor: typeof import("../src") })
          .NuniAnchor
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
  report.rate = rate
  report.wrong = wrong
  report.results = results
  writeFileSync(
    join(here, "..", "bench-report.json"),
    JSON.stringify(report, null, 2)
  )

  expect(rate, "re-anchoring success rate").toBeGreaterThanOrEqual(
    MIN_CORRECT_RATE
  )
  expect(wrong, "pins placed on the wrong element").toBeLessThanOrEqual(
    MAX_WRONG
  )
})

/** A large page: 500 cards (about 10,000 elements) and 200 pins on it. */
const PERF_PINS = 200
const PERF_BUDGET_MS = 4000

test("large page performance", async ({ page }) => {
  test.setTimeout(120_000)
  const cards = Array.from(
    { length: 500 },
    (
      _,
      i
    ) => `<article class="card"><header><h3>Item ${i}</h3><span class="tag">tag ${i % 7}</span></header>
      <ul>${Array.from({ length: 6 }, (_, j) => `<li><span>Detail ${j} of item ${i}</span></li>`).join("")}</ul>
      <footer><button type="button">Open ${i}</button><a href="/items/${i}">Share</a></footer></article>`
  ).join("")
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.setContent(
    `<!doctype html><html><body><main class="grid">${cards}</main></body></html>`
  )
  await page.addScriptTag({ content: bundle })
  const timing = await page.evaluate((pins) => {
    const api = (window as never as { NuniAnchor: typeof import("../src") })
      .NuniAnchor
    const targets = Array.from(
      document.querySelectorAll("button, h3, li span, a")
    ).filter((_, i) => i % 13 === 0)
    const anchors = targets.slice(0, pins).map((el) => api.captureAnchor(el))
    const total = document.getElementsByTagName("*").length
    const time = (cached: boolean) => {
      const cache = cached ? api.createResolveCache() : undefined
      const start = performance.now()
      let correct = 0
      anchors.forEach((a, i) => {
        if (api.resolveAnchor(a, document, {}, cache).element === targets[i])
          correct++
      })
      return { ms: Math.round(performance.now() - start), correct }
    }
    return {
      elements: total,
      pins: anchors.length,
      uncached: time(false),
      cached: time(true),
    }
  }, PERF_PINS)
  console.log(
    `Large page: ${timing.elements} elements, ${timing.pins} pins. Resolve all: ${timing.cached.ms} ms with the shared cache (${timing.uncached.ms} ms without).`
  )
  report.performance = { ...timing, budgetMs: PERF_BUDGET_MS }
  writeFileSync(
    join(here, "..", "bench-report.json"),
    JSON.stringify(report, null, 2)
  )
  expect(timing.cached.correct, "pins found on the large page").toBe(
    timing.pins
  )
  expect(timing.cached.ms, "time to resolve every pin").toBeLessThan(
    PERF_BUDGET_MS
  )
})
