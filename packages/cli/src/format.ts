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

/** A compact, numbered list: enough to pick a comment, not the full context. */
export function formatCommentList(
  comments: OwnerComment[],
  options: { status: string; more: boolean; detailHint: string }
): string {
  if (!comments.length) return `No ${options.status} comments.`
  const lines = [
    `${comments.length}${options.more ? "+" : ""} ${options.status} comment${comments.length === 1 ? "" : "s"}, newest first:`,
    "",
  ]
  comments.forEach((c, i) => {
    const element = c.anchor.text
      ? `<${c.anchor.tag}> "${oneLine(c.anchor.text, 60)}"`
      : `<${c.anchor.tag}>`
    lines.push(
      `${i + 1}. ${c._id} · ${c.page.path} · ${c.authorName} · ${timeAgo(c.createdAt)}`,
      `   "${oneLine(c.body)}"`,
      `   On ${element}`
    )
  })
  lines.push("", options.detailHint)
  return lines.join("\n")
}
