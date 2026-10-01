"use client"

import { api } from "@nuni/backend/api"
import type { Doc, Id } from "@nuni/backend/dataModel"
import { useMutation, useQuery } from "convex/react"
import {
  ArrowLeftIcon,
  GlobeIcon,
  LinkIcon,
  LogOutIcon,
  TerminalIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { CopyButton } from "@/components/copy-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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

/** Rename, sessions, and handing over or deleting a project. */
export function ProjectSettings({ publicId }: { publicId: string }) {
  const { ready } = useStoreUser()
  const project = useQuery(api.projects.getMine, ready ? { publicId } : "skip")

  if (!ready || project === undefined) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
      </div>
    )
  }
  if (project === null) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>Project not found</CardTitle>
          <CardDescription>
            This project does not exist, is being deleted, or belongs to someone
            else.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/"
            className="text-sm font-medium text-primary hover:underline"
          >
            Back to projects
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Link
          href={`/p/${publicId}`}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" /> {project.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </div>
      <RenameCard project={project} />
      <SessionsCard publicId={publicId} projectId={project._id} />
      <TransferCard projectId={project._id} />
      <DangerCard project={project} />
    </div>
  )
}

function RenameCard({ project }: { project: Doc<"projects"> }) {
  const rename = useMutation(api.projects.rename)
  const [value, setValue] = useState(project.name)
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle")
  const [error, setError] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Name</CardTitle>
        <CardDescription>Only you see it, in this dashboard.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex max-w-md gap-2"
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
          <Input
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setState("idle")
            }}
            aria-label="Project name"
            maxLength={100}
          />
          <Button
            type="submit"
            disabled={
              state === "saving" || !value.trim() || value === project.name
            }
          >
            {state === "saved" ? "Saved" : "Save"}
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}

function SessionsCard({
  publicId,
  projectId,
}: {
  publicId: string
  projectId: Id<"projects">
}) {
  const sessions = useQuery(api.sessions.listMine, { publicId })
  const revoke = useMutation(api.sessions.revoke)
  const revokeAll = useMutation(api.sessions.revokeAll)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Signed-in devices</CardTitle>
        <CardDescription>
          Browsers where you resolve comments from the widget, and terminals
          where the CLI or MCP server is signed in. Sign one out if you lost the
          device.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {sessions === undefined ? (
          <Skeleton className="h-16" />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No signed-in devices.</p>
        ) : (
          <>
            <ul className="grid divide-y rounded-2xl border">
              {sessions.map((s) => (
                <li
                  key={s._id}
                  className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm"
                >
                  {s.kind === "cli" ? (
                    <TerminalIcon className="size-4 text-muted-foreground" />
                  ) : (
                    <GlobeIcon className="size-4 text-muted-foreground" />
                  )}
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate font-medium">
                      {s.kind === "cli"
                        ? (s.userAgent ?? "Nuni CLI")
                        : describeAgent(s.userAgent)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {s.kind === "cli" ? "CLI and MCP" : hostOf(s.origin)} ·
                      signed in {timeAgo(s._creationTime)} · expires{" "}
                      {timeLeft(s.expiresAt)}
                    </span>
                  </div>
                  <Badge variant="outline">
                    {s.kind === "cli" ? "CLI" : "Widget"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void revoke({ id: s._id })}
                  >
                    Sign out
                  </Button>
                </li>
              ))}
            </ul>
            {sessions.length > 1 && (
              <Button
                variant="outline"
                className="w-fit"
                onClick={() => {
                  if (confirm("Sign out every device from this project?"))
                    void revokeAll({ projectId })
                }}
              >
                <LogOutIcon /> Sign out everywhere
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TransferCard({ projectId }: { projectId: Id<"projects"> }) {
  const active = useQuery(api.transfers.active, { projectId })
  const create = useMutation(api.transfers.create)
  const cancel = useMutation(api.transfers.cancel)
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer</CardTitle>
        <CardDescription>
          Hand this project to someone else. Send them the link; when they open
          it signed in and accept, they become the owner and you lose access.
          The link works once, for 7 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {link ? (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-xl bg-muted px-2.5 py-2 font-mono text-xs">
                {link}
              </code>
              <CopyButton value={link} label="Copy link" />
            </div>
            <p className="text-xs text-muted-foreground">
              Copy it now. It is shown only once.
            </p>
          </div>
        ) : active ? (
          <p className="text-sm text-muted-foreground">
            A transfer link is open. It expires {timeLeft(active.expiresAt)}.
          </p>
        ) : null}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
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
              onClick={async () => {
                await cancel({ projectId })
                setLink(null)
              }}
            >
              Cancel transfer
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function DangerCard({ project }: { project: Doc<"projects"> }) {
  const router = useRouter()
  const release = useMutation(api.projects.release)
  const remove = useMutation(api.projects.remove)
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
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-2">
          <h3 className="font-medium">Release</h3>
          <p className="text-sm text-muted-foreground">
            Give up ownership. Comments stay, every device is signed out, and
            anyone can claim the project again from the widget.
          </p>
          <Button
            variant="outline"
            className="w-fit"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  `Release ${project.name}? Anyone will be able to claim it.`
                )
              )
                void run(() => release({ projectId: project._id }))
            }}
          >
            <UnlinkIcon /> Release project
          </Button>
        </div>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() =>
              remove({ projectId: project._id, confirmName: confirmName })
            )
          }}
        >
          <h3 className="font-medium">Delete</h3>
          <p className="text-sm text-muted-foreground">
            Delete the project with all its comments, replies and screenshots.
            This can&apos;t be undone. If the widget is still on your site, the
            next comment starts a new, empty project with the same ID.
          </p>
          <label className="grid max-w-md gap-1.5 text-sm">
            <span>
              Type <strong>{project.name}</strong> to confirm
            </span>
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoComplete="off"
            />
          </label>
          <Button
            type="submit"
            variant="destructive"
            className="w-fit"
            disabled={busy || confirmName.trim() !== project.name.trim()}
          >
            <Trash2Icon /> Delete project
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
