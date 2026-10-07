"use client"

import { api } from "@nuni/backend/api"
import type { Doc, Id } from "@nuni/backend/dataModel"
import { buildAgentPrompt } from "@nuni/shared"
import { useMutation, useQuery } from "convex/react"
import {
  GlobeIcon,
  LinkIcon,
  PlusIcon,
  TerminalIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, type ReactNode } from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { CopyButton } from "@/components/copy-button"
import { ProjectHeader } from "@/components/project-header"
import { ProjectNotFound } from "@/components/project-view"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useStoreUser } from "@/components/use-store-user"
import { APP_URL, BASE_PATH } from "@/lib/config"
import {
  describeAgent,
  errorMessage,
  hostOf,
  timeAgo,
  timeLeft,
} from "@/lib/format"

/** Name, install details, sites, devices, and handing over or deleting a project. */
export function ProjectSettings({ publicId }: { publicId: string }) {
  const { ready } = useStoreUser()
  const project = useQuery(api.projects.getMine, ready ? { publicId } : "skip")

  if (!ready || project === undefined) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-24 w-64" />
        <Skeleton className="h-40 rounded-3xl" />
      </div>
    )
  }
  if (project === null) return <ProjectNotFound />

  return (
    <div className="grid gap-2">
      <ProjectHeader project={project} current="settings" />
      <div className="divide-y">
        <GeneralSection project={project} />
        <SitesSection project={project} />
        <SessionsSection publicId={publicId} projectId={project._id} />
        <TransferSection projectId={project._id} />
        <DangerSection project={project} />
      </div>
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: ReactNode
  children: ReactNode
}) {
  return (
    <section className="grid gap-4 py-8 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-10">
      <div className="grid content-start gap-1">
        <h2 className="font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid max-w-xl content-start gap-6">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function GeneralSection({ project }: { project: Doc<"projects"> }) {
  const rename = useMutation(api.projects.rename)
  const [value, setValue] = useState(project.name)
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle")
  const [error, setError] = useState<string | null>(null)
  return (
    <Section
      title="General"
      description="Use the same project ID on localhost, previews and production, so everyone sees the same comments."
    >
      <form
        className="grid gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          setState("saving")
          setError(null)
          try {
            await rename({ projectId: project._id, name: value })
            setState("saved")
          } catch (err) {
            setError(errorMessage(err))
            setState("idle")
          }
        }}
      >
        <label htmlFor="project-name" className="text-sm font-medium">
          Project name
        </label>
        <div className="flex gap-2">
          <Input
            id="project-name"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setState("idle")
            }}
            maxLength={100}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={
              state === "saving" || !value.trim() || value === project.name
            }
          >
            {state === "saved" ? "Saved" : "Save"}
          </Button>
        </div>
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only you see it, in this dashboard.
          </p>
        )}
      </form>
      <Field
        label="Project ID"
        hint="Public by design, like a publishable key. Commit it with your code."
      >
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-2xl bg-muted px-2.5 py-1.5 font-mono text-xs">
            {project.publicId}
          </code>
          <CopyButton value={project.publicId} />
        </div>
      </Field>
      <Field
        label="Setup prompt"
        hint="Paste it into Claude Code, Codex or Cursor to add Nuni to another codebase with this project ID."
      >
        <CopyButton
          value={buildAgentPrompt({ projectId: project.publicId })}
          label="Copy setup prompt"
          className="w-fit"
        />
      </Field>
    </Section>
  )
}

function SitesSection({ project }: { project: Doc<"projects"> }) {
  const addOrigin = useMutation(api.projects.addOrigin)
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Section
      title="Sites"
      description="Where you can resolve and reply from the widget. Add staging or production once it's deployed."
    >
      <ul
        aria-label="Sites"
        className="grid divide-y rounded-2xl ring-1 ring-foreground/10"
      >
        {project.origins.map((origin) => (
          <li
            key={origin}
            className="flex items-center gap-3 px-3 py-2.5 text-sm"
          >
            <GlobeIcon
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <a
              href={origin}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate hover:underline"
            >
              {hostOf(origin)}
            </a>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          const origin = value.trim()
          if (!origin) return
          setBusy(true)
          try {
            await addOrigin({ projectId: project._id, origin })
            setValue("")
            setError(null)
          } catch (err) {
            setError(errorMessage(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="flex gap-2">
          <Input
            placeholder="https://staging.example.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Add a site origin"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={busy || !value.trim()}
          >
            <PlusIcon /> Add site
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </form>
    </Section>
  )
}

function SessionsSection({
  publicId,
  projectId,
}: {
  publicId: string
  projectId: Id<"projects">
}) {
  const sessions = useQuery(api.sessions.listMine, { publicId })
  const revoke = useMutation(api.sessions.revoke)
  const revokeAll = useMutation(api.sessions.revokeAll)
  const [error, setError] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  return (
    <Section
      title="Signed-in devices"
      description="Browsers where you use owner tools in the widget, and terminals where the CLI or MCP server is signed in."
    >
      {sessions === undefined ? (
        <Skeleton className="h-14" />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No signed-in devices.</p>
      ) : (
        <div className="grid gap-3">
          <ul className="grid divide-y rounded-2xl ring-1 ring-foreground/10">
            {sessions.map((s) => (
              <li
                key={s._id}
                className="flex items-center gap-3 px-3 py-2.5 text-sm"
              >
                {s.kind === "cli" ? (
                  <TerminalIcon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                ) : (
                  <GlobeIcon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {s.kind === "cli"
                        ? (s.userAgent ?? "Nuni CLI")
                        : describeAgent(s.userAgent)}
                    </span>
                    <Badge variant="outline">
                      {s.kind === "cli" ? "CLI" : "Widget"}
                    </Badge>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {s.kind === "cli" ? "CLI and MCP" : hostOf(s.origin)} ·
                    signed in {timeAgo(s._creationTime)} · expires{" "}
                    {timeLeft(s.expiresAt)}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setError(null)
                    revoke({ id: s._id }).catch((err) =>
                      setError(errorMessage(err))
                    )
                  }}
                >
                  Sign out
                </Button>
              </li>
            ))}
          </ul>
          {sessions.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setConfirmAll(true)}
            >
              Sign out everywhere
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out every device?"
        description="Every browser and terminal signed in to this project is signed out. You can sign in again any time."
        action="Sign out everywhere"
        onConfirm={() =>
          revokeAll({ projectId }).catch((err) => setError(errorMessage(err)))
        }
      />
    </Section>
  )
}

function TransferSection({ projectId }: { projectId: Id<"projects"> }) {
  const active = useQuery(api.transfers.active, { projectId })
  const create = useMutation(api.transfers.create)
  const cancel = useMutation(api.transfers.cancel)
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <Section
      title="Transfer"
      description="Hand this project to someone else. When they open the link signed in and accept, they become the owner and you lose access."
    >
      {link ? (
        <Field label="Transfer link" hint="Copy it now. It's shown only once.">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-2xl bg-muted px-2.5 py-1.5 font-mono text-xs">
              {link}
            </code>
            <CopyButton value={link} label="Copy link" />
          </div>
        </Field>
      ) : active ? (
        <p className="text-sm text-muted-foreground">
          A transfer link is open. It expires {timeLeft(active.expiresAt)}.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          The link works once, for 7 days.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            setError(null)
            try {
              const { token } = await create({ projectId })
              setLink(
                `${APP_URL}${BASE_PATH}/transfer?token=${encodeURIComponent(token)}`
              )
            } catch (err) {
              setError(errorMessage(err))
            }
          }}
        >
          <LinkIcon /> {active || link ? "Make a new link" : "Make a link"}
        </Button>
        {(active || link) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await cancel({ projectId })
              setLink(null)
            }}
          >
            Cancel transfer
          </Button>
        )}
      </div>
    </Section>
  )
}

function DangerSection({ project }: { project: Doc<"projects"> }) {
  const router = useRouter()
  const release = useMutation(api.projects.release)
  const remove = useMutation(api.projects.remove)
  const [confirmRelease, setConfirmRelease] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmName, setConfirmName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      router.push("/")
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Section
      title="Danger zone"
      description="These change who owns the project, or remove it for good."
    >
      <DangerRow
        title="Release"
        description="Give up ownership. Comments stay, every device is signed out, and anyone can claim the project again from the widget."
      >
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setConfirmRelease(true)}
        >
          <UnlinkIcon /> Release project
        </Button>
      </DangerRow>
      <DangerRow
        title="Delete"
        description="Delete the project with all its comments, replies and screenshots. If the widget is still on your site, the next comment starts a new, empty project with the same ID."
      >
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={() => {
            setConfirmName("")
            setDeleting(true)
          }}
        >
          <Trash2Icon /> Delete project
        </Button>
      </DangerRow>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <ConfirmDialog
        open={confirmRelease}
        onOpenChange={setConfirmRelease}
        title={`Release ${project.name}?`}
        description="Anyone will be able to claim it from the widget. Comments stay."
        action="Release project"
        onConfirm={() => void run(() => release({ projectId: project._id }))}
      />
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <form
            className="grid gap-6"
            onSubmit={(e) => {
              e.preventDefault()
              void run(() => remove({ projectId: project._id, confirmName }))
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {project.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                All its comments, replies and screenshots are deleted. This
                can&apos;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <label className="grid gap-2 text-sm">
              <span>
                Type <strong className="font-medium">{project.name}</strong> to
                confirm
              </span>
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off"
              />
            </label>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                type="submit"
                variant="destructive"
                disabled={busy || confirmName.trim() !== project.name.trim()}
              >
                Delete project
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  )
}

function DangerRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div>{children}</div>
    </div>
  )
}
