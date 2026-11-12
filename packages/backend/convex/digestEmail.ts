/**
 * The activity email as text and HTML. Pure: everything it shows is handed
 * in, so the same email can be sent, previewed or tested.
 */

export type DigestStatus = "resolved" | "outdated" | "reopened"

export interface DigestThread {
  author: string
  body: string
  /** The words the commenter suggested, if any. */
  suggestion?: string
  /** The comment itself is new, not only its replies or status. */
  isNew: boolean
  status?: DigestStatus
  replies: { author: string; body: string }[]
  /** Replies that are new but not listed. */
  moreReplies: number
  /** The comment on its page, or null when the page can't be linked. */
  link: string | null
}

export interface DigestPage {
  path: string
  title: string
  threads: DigestThread[]
}

export interface DigestCounts {
  comments: number
  replies: number
  resolved: number
  reopened: number
}

export interface Digest {
  projectName: string
  pages: DigestPage[]
  counts: DigestCounts
  /** Comments with activity that aren't listed. */
  moreThreads: number
  projectUrl: string
  settingsUrl: string
  unsubscribeUrl: string
}

const STATUS_LABEL: Record<DigestStatus, string> = {
  resolved: "Resolved",
  outdated: "Closed as outdated",
  reopened: "Reopened",
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

/** "3 new comments, 1 reply, 2 resolved": only what happened. */
export function summarize(counts: DigestCounts): string {
  return [
    counts.comments && plural(counts.comments, "new comment"),
    counts.replies && plural(counts.replies, "reply", "replies"),
    counts.resolved && `${counts.resolved} resolved`,
    counts.reopened && `${counts.reopened} reopened`,
  ]
    .filter(Boolean)
    .join(", ")
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Escaped text with its line breaks kept. */
function htmlText(value: string) {
  return escapeHtml(value).replace(/\n/g, "<br>")
}

function threadLabel(thread: DigestThread) {
  const what = thread.isNew ? "commented" : "'s comment"
  const status = thread.status ? ` · ${STATUS_LABEL[thread.status]}` : ""
  return { who: thread.author, what, status }
}

function moreRepliesLine(thread: DigestThread) {
  return thread.moreReplies
    ? `and ${plural(thread.moreReplies, "more reply", "more replies")}`
    : ""
}

function moreThreadsLine(digest: Digest) {
  return digest.moreThreads
    ? `And ${plural(digest.moreThreads, "more comment")} with new activity.`
    : ""
}

function textThread(thread: DigestThread): string {
  const { who, what, status } = threadLabel(thread)
  const head = thread.isNew ? `${who} ${what}` : `${who}${what}`
  const lines = [`${head}${status}`, indent(thread.body)]
  if (thread.suggestion) lines.push(indent(`Suggested: ${thread.suggestion}`))
  for (const reply of thread.replies) {
    lines.push(indent(`${reply.author} replied:`), indent(reply.body, 4))
  }
  const more = moreRepliesLine(thread)
  if (more) lines.push(indent(more))
  if (thread.link) lines.push(indent(`Open: ${thread.link}`))
  return lines.join("\n")
}

function indent(value: string, by = 2) {
  const pad = " ".repeat(by)
  return value
    .split("\n")
    .map((line) => pad + line)
    .join("\n")
}

function renderText(digest: Digest): string {
  const parts = [`${summarize(digest.counts)} on ${digest.projectName}.`]
  for (const page of digest.pages) {
    parts.push(
      [pageHeading(page), ...page.threads.map(textThread)].join("\n\n")
    )
  }
  const more = moreThreadsLine(digest)
  if (more) parts.push(more)
  parts.push(
    `See everything: ${digest.projectUrl}`,
    [
      "You get this because you own this project on Nuni.",
      `Change how often: ${digest.settingsUrl}`,
      `Turn these emails off: ${digest.unsubscribeUrl}`,
    ].join("\n")
  )
  return parts.join("\n\n")
}

function pageHeading(page: DigestPage) {
  return page.title && page.title !== page.path
    ? `${page.title} (${page.path})`
    : page.path
}

const FONT =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MUTED = "color:#6b7280"
const LINK = "color:#111827;text-decoration:underline"

function htmlThread(thread: DigestThread): string {
  const { who, what, status } = threadLabel(thread)
  const gap = thread.isNew ? " " : ""
  const rows = [
    `<p style="margin:0 0 4px;font-size:14px"><strong>${escapeHtml(who)}</strong>${gap}<span style="${MUTED}">${escapeHtml(what + status)}</span></p>`,
    `<p style="margin:0;font-size:14px;line-height:1.5">${htmlText(thread.body)}</p>`,
  ]
  if (thread.suggestion) {
    rows.push(
      `<p style="margin:6px 0 0;font-size:14px;line-height:1.5"><span style="${MUTED}">Suggested:</span> ${htmlText(thread.suggestion)}</p>`
    )
  }
  for (const reply of thread.replies) {
    rows.push(
      `<div style="margin:10px 0 0;padding-left:12px;border-left:2px solid #e5e7eb"><p style="margin:0 0 2px;font-size:13px"><strong>${escapeHtml(reply.author)}</strong> <span style="${MUTED}">replied</span></p><p style="margin:0;font-size:14px;line-height:1.5">${htmlText(reply.body)}</p></div>`
    )
  }
  const more = moreRepliesLine(thread)
  if (more) {
    rows.push(
      `<p style="margin:8px 0 0;font-size:13px;${MUTED}">${escapeHtml(more)}</p>`
    )
  }
  if (thread.link) {
    rows.push(
      `<p style="margin:8px 0 0;font-size:13px"><a href="${escapeHtml(thread.link)}" style="${LINK}">Open on the page</a></p>`
    )
  }
  return `<div style="margin:0 0 12px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px">${rows.join("")}</div>`
}

function renderHtml(digest: Digest): string {
  const pages = digest.pages
    .map(
      (page) =>
        `<h2 style="margin:24px 0 10px;font-size:13px;font-weight:600;${MUTED}">${escapeHtml(pageHeading(page))}</h2>${page.threads.map(htmlThread).join("")}`
    )
    .join("")
  const more = moreThreadsLine(digest)
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(digest.projectName)}</title></head>
<body style="margin:0;padding:24px 16px;background:#ffffff;color:#111827;${FONT}">
<div style="max-width:560px;margin:0 auto">
<h1 style="margin:0 0 4px;font-size:18px;font-weight:600">${escapeHtml(digest.projectName)}</h1>
<p style="margin:0;font-size:14px;${MUTED}">${escapeHtml(summarize(digest.counts))}</p>
${pages}
${more ? `<p style="margin:0 0 12px;font-size:14px;${MUTED}">${escapeHtml(more)}</p>` : ""}
<p style="margin:20px 0 0"><a href="${escapeHtml(digest.projectUrl)}" style="display:inline-block;padding:9px 16px;border-radius:999px;background:#111827;color:#ffffff;font-size:14px;text-decoration:none">Open in Nuni</a></p>
<p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;${MUTED}">You get this because you own this project on Nuni. <a href="${escapeHtml(digest.settingsUrl)}" style="${MUTED}">Change how often</a> or <a href="${escapeHtml(digest.unsubscribeUrl)}" style="${MUTED}">turn these emails off</a>.</p>
</div>
</body>
</html>`
}

export function renderDigest(digest: Digest) {
  return {
    subject: `${digest.projectName}: ${summarize(digest.counts)}`,
    text: renderText(digest),
    html: renderHtml(digest),
  }
}
