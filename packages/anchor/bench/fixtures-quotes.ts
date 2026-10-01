/**
 * Text comments: a selection inside a paragraph, a list item or a cell,
 * found again after the words around it, or the page around it, changed.
 * The quote must come back as the same words in the element marked
 * `data-bench-target` (or be reported missing when it was deleted).
 */
import type { Scenario } from "./fixtures"

const T = " data-bench-target"

const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.6 Georgia, serif; color: #222; }
  header, footer { padding: 12px 24px; font-family: system-ui; }
  article { max-width: 680px; margin: 0 auto; padding: 24px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #ddd; padding: 8px; text-align: left; }
  .callout { background: #f1f5f9; padding: 12px 16px; border-radius: 8px; }
`

function doc(body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
    <header><a href="/">Acme Blog</a></header>${body}<footer>© Acme</footer></body></html>`
}

interface Para {
  text: string
  target?: boolean
}

function article(
  paras: (Para | string)[],
  o: { title?: string; wrap?: boolean } = {}
) {
  const body = paras
    .map((p) => {
      const para = typeof p === "string" ? { text: p } : p
      return `<p${para.target ? T : ""}>${para.text}</p>`
    })
    .join("\n")
  const inner = `<h1>${o.title ?? "Shipping faster with smaller pull requests"}</h1>
    <p class="byline">By Sam Rivera · 6 min read</p>${body}`
  return doc(
    o.wrap
      ? `<main class="layout"><div class="content-wrapper"><article class="post">${inner}</article></div></main>`
      : `<article>${inner}</article>`
  )
}

const INTRO =
  "Small pull requests are easier to review, easier to revert and easier to understand months later."
const PARAS = [
  "Every team we talked to said the same thing: reviews take too long, and the biggest changes wait the longest.",
  "We set a soft limit of 400 changed lines per pull request and tracked review time for a quarter.",
  "The median time to first review dropped from 19 hours to 4 hours, and reverts fell by a third.",
  "If a change has to be big, split it into a stack: refactor first, then the feature, then the cleanup.",
]

const FAQ = [
  [
    "Can I cancel anytime?",
    "Yes. You can cancel anytime from the billing page.",
  ],
  [
    "Do you offer refunds?",
    "Yes. Contact support within 30 days for a full refund.",
  ],
  [
    "Is there a free plan?",
    "Yes. The free plan includes one project. Contact support to raise limits.",
  ],
]

function faq(order: number[], target: number, edited = false) {
  return doc(
    `<article><h1>Help center</h1>${order
      .map((i) => {
        const [q, a] = FAQ[i] as [string, string]
        const answer =
          edited && i === target ? a.replace("Yes.", "Yes, of course.") : a
        return `<section class="faq-item"><h3>${q}</h3><p${i === target ? T : ""}>${answer}</p></section>`
      })
      .join("")}</article>`
  )
}

const STEPS = [
  "Install the package with your package manager.",
  "Add the script tag to your root layout.",
  "Deploy and open the site to leave the first comment.",
  "Claim the project from the toolbar to manage comments.",
]

function steps(order: number[], target: number) {
  return doc(
    `<article><h1>Quick start</h1><ol class="steps">${order
      .map((i) => `<li${i === target ? T : ""}>${STEPS[i]}</li>`)
      .join("")}</ol></article>`
  )
}

const ROWS: [string, string, string][] = [
  ["Starter", "$0", "One project and community support."],
  ["Pro", "$20", "Unlimited projects and priority email support."],
  ["Team", "$40", "Everything in Pro plus shared billing and SSO."],
]

function table(order: number[], target: number) {
  return doc(
    `<article><h1>Compare plans</h1><table><thead><tr><th>Plan</th><th>Price</th><th>Includes</th></tr></thead><tbody>${order
      .map((i) => {
        const [name, price, notes] = ROWS[i]!
        return `<tr><td>${name}</td><td>${price}</td><td${i === target ? T : ""}>${notes}</td></tr>`
      })
      .join("")}</tbody></table></article>`
  )
}

export const quoteScenarios: Scenario[] = [
  {
    name: "quote, words edited around it",
    category: "quote",
    before: article([INTRO, { text: PARAS[1]!, target: true }, PARAS[2]!]),
    after: article([
      INTRO,
      {
        text: "Last year we set a soft limit of 400 changed lines per pull request and then tracked review time for a full quarter.",
        target: true,
      },
      PARAS[2]!,
    ]),
    quote: { text: "a soft limit of 400 changed lines" },
    expect: "found",
  },
  {
    name: "quote, paragraphs inserted above",
    category: "quote",
    before: article([
      INTRO,
      ...PARAS.slice(0, 2),
      { text: PARAS[2]!, target: true },
    ]),
    after: article([
      INTRO,
      "Update: we published the raw numbers in the appendix.",
      ...PARAS.slice(0, 2),
      "Here is what changed.",
      { text: PARAS[2]!, target: true },
    ]),
    quote: { text: "dropped from 19 hours to 4 hours" },
    expect: "found",
  },
  {
    name: "quote, sentence moved to the next paragraph",
    category: "quote",
    before: article([
      INTRO,
      {
        text: `${PARAS[0]} Nobody wants to review a thousand lines on a Friday.`,
        target: true,
      },
      PARAS[1]!,
    ]),
    after: article([
      INTRO,
      PARAS[0]!,
      {
        text: `Nobody wants to review a thousand lines on a Friday. ${PARAS[1]}`,
        target: true,
      },
    ]),
    quote: { text: "Nobody wants to review a thousand lines on a Friday." },
    expect: "found",
  },
  {
    name: "quote, repeated phrase in one paragraph",
    category: "quote",
    before: article([
      INTRO,
      {
        text: "Review early. Then review again after the tests pass, and review once more before merging.",
        target: true,
      },
    ]),
    after: article([
      INTRO,
      PARAS[0]!,
      {
        text: "Review early. Then review again after the tests pass, and review once more before you merge.",
        target: true,
      },
    ]),
    quote: { text: "review", before: 1, after: 1 },
    expect: "found",
  },
  {
    name: "quote, same words in two answers",
    category: "quote",
    before: faq([0, 1, 2], 2),
    after: faq([2, 0, 1], 2),
    quote: { text: "Contact support" },
    expect: "found",
  },
  {
    name: "quote, answer edited and reordered",
    category: "quote",
    before: faq([0, 1, 2], 0),
    after: faq([1, 0, 2], 0, true),
    quote: { text: "cancel anytime from the billing page" },
    expect: "found",
  },
  {
    name: "quote, words slightly edited",
    category: "quote",
    before: article([INTRO, { text: PARAS[3]!, target: true }]),
    after: article([
      INTRO,
      {
        text: "If a change has to be big, split it into a stack: refactor first, then the new feature, then the cleanup.",
        target: true,
      },
    ]),
    quote: {
      text: "refactor first, then the feature, then the cleanup",
      afterText: "refactor first, then the new feature, then the cleanup",
    },
    expect: "found",
  },
  {
    name: "quote, now wrapped in a link and bold",
    category: "quote",
    before: article([INTRO, { text: PARAS[2]!, target: true }]),
    after: article([
      INTRO,
      {
        text: 'The median time to <a href="/glossary">first review</a> dropped from <strong>19 hours to 4 hours</strong>, and reverts fell by a third.',
        target: true,
      },
    ]),
    quote: { text: "first review dropped from 19 hours" },
    expect: "found",
  },
  {
    name: "quote, list reordered",
    category: "quote",
    before: steps([0, 1, 2, 3], 2),
    after: steps([0, 3, 1, 2], 2),
    quote: { text: "leave the first comment" },
    expect: "found",
  },
  {
    name: "quote, table rows sorted",
    category: "quote",
    before: table([0, 1, 2], 1),
    after: table([2, 1, 0], 1),
    quote: { text: "priority email support" },
    expect: "found",
  },
  {
    name: "quote, page wrapped in new layout",
    category: "quote",
    before: article([INTRO, { text: PARAS[0]!, target: true }, PARAS[1]!]),
    after: article([INTRO, { text: PARAS[0]!, target: true }, PARAS[1]!], {
      wrap: true,
    }),
    quote: { text: "the biggest changes wait the longest" },
    expect: "found",
  },
  {
    name: "quote, words deleted",
    category: "quote",
    before: article([INTRO, { text: PARAS[2]!, target: true }, PARAS[3]!]),
    after: article([
      INTRO,
      "The median time to first review dropped a lot.",
      PARAS[3]!,
    ]),
    quote: { text: "and reverts fell by a third" },
    expect: "lost",
  },
]
