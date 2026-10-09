import { commentUrl } from "./path"
import { PACKAGES } from "./prompt"
import type { OwnerComment } from "./types"

export interface CommentPromptOptions {
  /**
   * Include the owner-only context (DOM, styles, console, network,
   * screenshot). Defaults to true; the fields are skipped when absent.
   */
  includeContext?: boolean
}

/** A code fence longer than any backtick run inside `content`. */
function fence(content: string, lang = ""): string {
  const longest = Math.max(
    0,
    ...Array.from(content.matchAll(/`+/g), (m) => m[0].length)
  )
  const ticks = "`".repeat(Math.max(3, longest + 1))
  return `${ticks}${lang}\n${content}\n${ticks}`
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
}

function inline(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim()
  return clean.includes("`") ? `"${clean}"` : `\`${clean}\``
}

/**
 * One comment as a ready-to-paste task for a coding agent. Single source of
 * truth for the widget, dashboard, CLI and MCP server.
 */
export function buildCommentPrompt(
  comment: OwnerComment,
  options: CommentPromptOptions = {}
): string {
  const includeContext = options.includeContext ?? true
  const { anchor, page } = comment
  const out: string[] = []

  out.push(
    "Fix this piece of feedback that was left on the live site with Nuni.",
    "",
    "## Comment",
    "",
    ...(comment.body ? [quote(comment.body), ""] : []),
    ...(comment.suggestion
      ? [
          "Suggested text change. Replace:",
          "",
          quote(comment.suggestion.before),
          "",
          "With:",
          "",
          quote(comment.suggestion.after),
          "",
        ]
      : []),
    `From ${comment.authorName} on ${new Date(comment.createdAt).toISOString().slice(0, 10)}` +
      (comment.status === "resolved" ? " (already resolved)" : "")
  )

  if (comment.replies?.length) {
    out.push("", `## Replies (${comment.replies.length})`, "")
    for (const reply of comment.replies) {
      out.push(
        `${reply.authorName}${reply.isOwner ? " (owner)" : ""}:`,
        quote(reply.body),
        ""
      )
    }
    out.pop()
  }

  out.push("", "## Where", "")
  out.push(`- Page: ${page.title ? `${page.title} ` : ""}(${page.path})`)
  out.push(`- Open it: ${commentUrl(page, comment._id)}`)
  out.push(
    `- Viewport: ${comment.viewport.w}×${comment.viewport.h} at ${comment.viewport.dpr}x`
  )
  if (includeContext && comment.userAgent) {
    out.push(`- Browser: ${comment.userAgent}`)
  }

  out.push("", "## Element", "")
  out.push(`- Tag: <${anchor.tag}>`)
  if (anchor.text) out.push(`- Text: ${inline(anchor.text)}`)
  if (anchor.quote) {
    out.push(`- Selected text: ${inline(anchor.quote.exact)}`)
  }
  if (anchor.region) {
    const pct = (n: number) => `${Math.round(n * 100)}%`
    const r = anchor.region
    out.push(
      `- Area: ${pct(r.w)} × ${pct(r.h)} of the element, from ${pct(r.x)} left and ${pct(r.y)} top`
    )
  }
  if (anchor.componentName) {
    out.push(`- React component: ${anchor.componentName}`)
  }
  if (anchor.selectors.testId) {
    out.push(`- Test ID: ${inline(anchor.selectors.testId)}`)
  }
  if (anchor.selectors.id) out.push(`- ID: ${inline(anchor.selectors.id)}`)
  if (anchor.selectors.css) {
    out.push(`- CSS selector: ${inline(anchor.selectors.css)}`)
  }
  out.push(`- DOM path: ${inline(anchor.selectors.path)}`)
  const labels = Object.entries(anchor.attrs)
    .filter(([name]) => name !== "class" && name !== "style")
    .map(([name, value]) => `${name}="${value}"`)
  if (labels.length) out.push(`- Attributes: ${inline(labels.join(" "))}`)

  const context = includeContext ? comment.context : undefined
  if (context?.dom?.html) {
    out.push("", fence(context.dom.html, "html"))
  }
  const styles = Object.entries(context?.dom?.styles ?? {})
  if (styles.length) {
    out.push(
      "",
      "Computed styles:",
      "",
      fence(styles.map(([k, v]) => `${k}: ${v};`).join("\n"), "css")
    )
  }

  if (context?.console?.length) {
    out.push("", `## Console (${context.console.length})`, "")
    out.push(
      fence(
        context.console.map((e) => `[${e.level}] ${e.message}`).join("\n"),
        "text"
      )
    )
  }
  if (context?.network?.length) {
    out.push("", `## Failed requests (${context.network.length})`, "")
    for (const r of context.network) {
      out.push(
        `- ${r.method} ${r.url} → ${r.status === 0 ? "network error" : r.status}`
      )
    }
  }
  if (includeContext && comment.screenshotUrl) {
    out.push("", "## Screenshot", "", comment.screenshotUrl)
  }

  out.push(
    "",
    "## Steps",
    "",
    "1. Find the code that renders this element. Search for the text, the component name, the test ID or the selector.",
    comment.suggestion
      ? "2. Replace the text exactly as suggested (wherever it comes from: markup, a component, a translation or content file), and keep the fix focused on it."
      : "2. Make the change the comment asks for, and keep the fix focused on it.",
    "3. Tell me what you changed, so the comment can be resolved in Nuni.",
    `   If the Nuni CLI is signed in to this project (\`npx ${PACKAGES.cli}@latest login\`), resolve it with \`npx ${PACKAGES.cli}@latest resolve ${comment._id}\` or the \`resolve_comment\` MCP tool.`
  )
  return out.join("\n")
}
