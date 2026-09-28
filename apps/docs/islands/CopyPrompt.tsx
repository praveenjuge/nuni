import { buildAgentPrompt, generateProjectId } from "@nuni/shared"
import { useEffect, useState } from "react"

export const client = "only"

/** Generates a fresh project ID in the browser and bakes it into the prompt. */
export default function CopyPrompt() {
  const [projectId, setProjectId] = useState("")
  const [copied, setCopied] = useState(false)
  useEffect(() => setProjectId(generateProjectId()), [])
  const prompt = projectId ? buildAgentPrompt({ projectId }) : ""

  return (
    <div className="not-prose my-6 overflow-hidden rounded-xl border border-border bg-muted/40">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            Paste this into Codex, Claude Code or Cursor
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            Your project ID: {projectId || "…"}
          </div>
        </div>
        <button
          type="button"
          className="rounded-lg bg-[var(--color-accent,#d6246e)] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          style={{ background: "#d6246e" }}
          disabled={!prompt}
          onClick={async () => {
            await navigator.clipboard.writeText(prompt)
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }}
        >
          {copied ? "Copied!" : "Copy prompt"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
          onClick={() => setProjectId(generateProjectId())}
          title="Generate a different project ID"
        >
          New ID
        </button>
      </div>
      <div className="max-h-72 overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {prompt}
      </div>
    </div>
  )
}
