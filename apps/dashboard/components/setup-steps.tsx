"use client"

import { buildAgentPrompt, DOCS_URL, generateProjectId } from "@nuni/shared"
import { PlusIcon } from "lucide-react"
import { useState, type ReactNode } from "react"

import { CopyButton } from "@/components/copy-button"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

/** How a site becomes a project: install the widget, then claim it from the page. */
export function SetupSteps() {
  // A fresh ID each time, like `nuni init`. It only becomes a project once used.
  const [projectId] = useState(generateProjectId)
  return (
    <ol className="grid gap-5 text-left">
      <Step n={1} title="Add Nuni to your site">
        <p>
          Paste this prompt into Claude Code, Codex or Cursor. It includes a new
          project ID and installs the right package for your framework.
        </p>
        <CopyButton
          value={buildAgentPrompt({ projectId })}
          label="Copy setup prompt"
          className="w-fit"
        />
        <p>
          Prefer the terminal? Run{" "}
          <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            npx @nuniapp/cli@latest init
          </code>
        </p>
      </Step>
      <Step n={2} title="Claim it">
        <p>
          Open your site, click the Nuni button and choose{" "}
          <span className="font-medium text-foreground">Claim Nuni</span>. The
          project shows up here with all its comments.
        </p>
      </Step>
    </ol>
  )
}

function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: ReactNode
}) {
  return (
    <li className="grid grid-cols-[1.5rem_1fr] gap-x-3 gap-y-1">
      <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums">
        {n}
      </span>
      <span className="self-center font-medium">{title}</span>
      <div className="col-start-2 grid gap-3 text-sm text-muted-foreground">
        {children}
      </div>
    </li>
  )
}

export function NewProjectDialog() {
  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon /> New project
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Nuni to a site</DialogTitle>
          <DialogDescription>
            Two steps, and no keys to manage.{" "}
            <a href={`${DOCS_URL}/quickstart`}>Read the quickstart</a>
          </DialogDescription>
        </DialogHeader>
        <SetupSteps />
      </DialogContent>
    </Dialog>
  )
}
