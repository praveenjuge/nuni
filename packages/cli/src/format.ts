import type { OwnerComment } from "@nuni/shared"

export function timeAgo(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return "just now"
  const steps: [number, string][] = [
    [60, "minute"],
    [24, "hour"],
    [30, "day"],
    [12, "month"],
    [Infinity, "year"],
  ]
  let value = seconds / 60
  for (const [size, unit] of steps) {
    if (value < size) {
      const n = Math.floor(value)
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`
    }
    value /= size
  }
  return "a long time ago"
}

function oneLine(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export type GroupBy = "page" | "element"

/**
 * What a comment is about, for grouping: the page plus the element's
 * strongest selector, plus the words for a text comment.
 */
function elementKey(c: OwnerComment): string {
  const { selectors } = c.anchor
  const target = selectors.testId
    ? `[data-testid="${selectors.testId}"]`
    : selectors.id
      ? `#${selectors.id}`
      : (selectors.css ?? selectors.path)
  const quote = c.anchor.quote ? ` "${oneLine(c.anchor.quote.exact, 60)}"` : ""
  return `${c.page.path} · ${target}${quote}`
}

function describe(c: OwnerComment, n: number): string[] {
  const element = c.anchor.text
    ? `<${c.anchor.tag}> "${oneLine(c.anchor.text, 60)}"`
    : `<${c.anchor.tag}>`
  return [
    `${n}. ${c._id} · ${c.page.path} · ${c.authorName} · ${timeAgo(c.createdAt)}`,
    `   "${oneLine(c.body)}"`,
    c.anchor.quote
      ? `   On the text "${oneLine(c.anchor.quote.exact, 60)}" in ${element}`
      : `   ${c.anchor.region ? "On an area of" : "On"} ${element}`,
  ]
}

/**
 * A compact, numbered list: enough to pick a comment, not the full context.
 * Grouped by page or by element, related comments sit together so they can
 * be fixed in one go.
 */
export function formatCommentList(
  comments: OwnerComment[],
  options: {
    status: string
    more: boolean
    detailHint: string
    order?: string
    groupBy?: GroupBy
  }
): string {
  if (!comments.length) return `No ${options.status} comments.`
  const lines = [
    `${comments.length}${options.more ? "+" : ""} ${options.status} comment${comments.length === 1 ? "" : "s"}, ${options.order ?? "newest first"}${options.groupBy ? `, grouped by ${options.groupBy}` : ""}:`,
    "",
  ]
  if (!options.groupBy) {
    comments.forEach((c, i) => lines.push(...describe(c, i + 1)))
  } else {
    const keyOf =
      options.groupBy === "page" ? (c: OwnerComment) => c.page.path : elementKey
    const groups = new Map<string, OwnerComment[]>()
    for (const c of comments) {
      const key = keyOf(c)
      groups.set(key, [...(groups.get(key) ?? []), c])
    }
    let n = 0
    for (const [key, group] of groups) {
      lines.push(`## ${key} (${group.length})`)
      for (const c of group) lines.push(...describe(c, ++n))
      lines.push("")
    }
    lines.pop()
  }
  lines.push("", options.detailHint)
  return lines.join("\n")
}

/** Pages with open comments, most first. */
export function formatPageList(
  pages: { path: string; openCount: number }[]
): string {
  if (!pages.length) return "No pages with open comments."
  const width = Math.max(...pages.map((p) => String(p.openCount).length))
  return [
    `${pages.length} page${pages.length === 1 ? "" : "s"} with open comments:`,
    "",
    ...pages.map(
      (p) => `${String(p.openCount).padStart(width)} open  ${p.path}`
    ),
  ].join("\n")
}
