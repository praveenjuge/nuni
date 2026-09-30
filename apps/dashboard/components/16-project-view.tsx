"use client"

import { api } from "@nuni/backend/api"
import type { Id } from "@nuni/backend/dataModel"
import { buildAgentPrompt } from "@nuni/shared"
import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import {
  ArrowLeftIcon,
  CheckIcon,
  ExternalLinkIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import { CopyButton } from "@/components/copy-button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useStoreUser } from "@/components/use-store-user"
import { hostOf, initials, jumpUrl, timeAgo, timeUntil } from "@/lib/format"

type Status = "open" | "resolved"

export function ProjectView({ publicId }: { publicId: string }) {
  const { ready } = useStoreUser()
  const project = useQuery(api.projects.getMine, ready ? { publicId } : "skip")
  const [status, setStatus] = useState<Status>("open")

  if (!ready || project === undefined) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    )
  }
  if (project === null) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>Project not found</CardTitle>
          <CardDescription>
            This project does not exist or belongs to someone else. Claim it
            from the widget on your site first.
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
    <div className="grid gap-8">
      <div className="grid gap-2">
        <Link
          href="/"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" /> Projects
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ProjectName projectId={project._id} name={project.name} />
          <CopyButton
            value={buildAgentPrompt({ projectId: publicId })}
            label="Copy agent prompt"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">
            {project.publicId}
          </code>
          {project.origins.map((o) => (
            <Badge key={o} variant="outline">
              {hostOf(o)}
            </Badge>
          ))}
          <AddOrigin projectId={project._id} />
        </div>
      </div>

      <section className="grid gap-4">
        <Tabs value={status} onValueChange={(v) => setStatus(v as Status)}>
          <TabsList>
            <TabsTrigger value="open">Open ({project.openCount})</TabsTrigger>
            <TabsTrigger value="resolved">
              Resolved ({Math.max(0, project.commentCount - project.openCount)})
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <CommentList publicId={publicId} status={status} />
      </section>

      <SessionList publicId={publicId} />
    </div>
  )
}

function AddOrigin({ projectId }: { projectId: Id<"projects"> }) {
  const addOrigin = useMutation(api.projects.addOrigin)
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        const origin = value.trim()
        if (!origin) return
        setBusy(true)
        try {
          await addOrigin({ projectId, origin })
          setValue("")
          setError(null)
        } catch (err) {
          setError(
            (err as { data?: { message?: string } })?.data?.message ??
              "Could not add that origin."
          )
        } finally {
          setBusy(false)
        }
      }}
    >
      <Input
        className="h-7 w-56 text-xs"
        placeholder="https://staging.example.com"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Add a site origin"
      />
      <Button type="submit" size="sm" variant="outline" disabled={busy}>
        <PlusIcon /> Add site
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  )
}

/**
 * Active widget owner sessions for this project, with revocation. A session
 * is created when the owner allows owner tools on a site; revoking one
 * immediately stops that token from resolving or deleting comments.
 */
function SessionList({ publicId }: { publicId: string }) {
  const sessions = useQuery(api.sessions.listMine, { publicId })
  const revoke = useMutation(api.sessions.revoke)
  if (sessions === undefined) return <Skeleton className="h-20 rounded-3xl" />
  return (
    <section className="grid gap-3">
      <h2 className="text-sm font-medium">Owner sessions</h2>
      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active sessions. Allow owner tools from the Nuni button on your
          site to create one.
        </p>
      ) : (
        <ul className="grid gap-2">
          {sessions.map((s) => (
            <li key={s._id}>
              <Card size="sm">
                <CardContent className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline">{hostOf(s.origin)}</Badge>
                  <span className="text-muted-foreground">
                    expires {timeUntil(s.expiresAt)}
                  </span>
                  {s.userAgent && (
                    <span className="max-w-md truncate text-xs text-muted-foreground">
                      {s.userAgent}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-destructive"
                    onClick={() => {
                      if (
                        confirm(
                          "Revoke this session? Owner tools on that site stop working immediately."
                        )
                      )
                        void revoke({ id: s._id })
                    }}
                  >
                    <Trash2Icon /> Revoke
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ProjectName({
  projectId,
  name,
}: {
  projectId: Id<"projects">
  name: string
}) {
  const rename = useMutation(api.projects.rename)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  if (!editing) {
    return (
      <h1 className="text-2xl font-semibold tracking-tight">
        <Button
          variant="ghost"
          className="h-auto px-0 text-2xl font-semibold tracking-tight"
          title="Rename"
          onClick={() => {
            setValue(name)
            setEditing(true)
          }}
        >
          {name}
        </Button>
      </h1>
    )
  }
  return (
    <form
      className="flex max-w-md gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        if (value.trim()) await rename({ projectId, name: value })
        setEditing(false)
      }}
    >
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Project name"
      />
      <Button type="submit">Save</Button>
      <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  )
}

function CommentList({
  publicId,
  status,
}: {
  publicId: string
  status: Status
}) {
  const [pageInput, setPageInput] = useState("")
  const page = useDebounced(pageInput.trim(), 250)
  const [origin, setOrigin] = useState("")
  const [query, setQuery] = useState("")
  const search = useDebounced(query.trim(), 250)
  // Filtering happens on the server, so it covers comments not loaded yet.
  const {
    results,
    status: loadStatus,
    loadMore,
  } = usePaginatedQuery(
    api.comments.listForOwner,
    {
      publicId,
      status,
      ...(page ? { path: page } : {}),
      ...(origin ? { origin } : {}),
      ...(search ? { search } : {}),
    },
    { initialNumItems: 50 }
  )
  const comments = loadStatus === "LoadingFirstPage" ? undefined : results
  const filters = useQuery(api.comments.ownerFilters, { publicId })
  const resolve = useMutation(api.comments.resolve)
  const reopen = useMutation(api.comments.reopen)
  const remove = useMutation(api.comments.remove)

  const pages = useMemo(() => [...(filters?.paths ?? [])].sort(), [filters])
  const origins = useMemo(() => [...(filters?.origins ?? [])].sort(), [filters])
  const filtered = comments ?? []
  const hasFilters = Boolean(pageInput || origin || query)

  if (comments === undefined) return <Skeleton className="h-40 rounded-3xl" />

  return (
    <div className="grid gap-3">
      {(comments.length > 0 || hasFilters) && (
        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-xs"
            placeholder="Search comments"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search comments"
          />
          {/* Free text with suggestions, so paths beyond the suggestion list still work. */}
          <Input
            className="max-w-xs"
            placeholder="All pages"
            list={`nuni-pages-${status}`}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            aria-label="Filter by page path"
          />
          <datalist id={`nuni-pages-${status}`}>
            {pages.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          {origins.length > 1 && (
            <Select
              value={origin || "all"}
              onValueChange={(value) =>
                setOrigin(value === "all" ? "" : (value ?? ""))
              }
            >
              <SelectTrigger aria-label="Filter by site">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All environments</SelectItem>
                {origins.map((o) => (
                  <SelectItem key={o} value={o}>
                    {hostOf(o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {!hasFilters
              ? status === "open"
                ? "No open comments. Nice."
                : "Nothing resolved yet."
              : "No comments match these filters."}
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-2">
          {filtered.map((c) => (
            <li key={c._id}>
              <Card size="sm">
                <CardContent className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Avatar className="size-6">
                      <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
                        {initials(c.authorName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{c.authorName}</span>
                    <span className="text-muted-foreground">
                      {timeAgo(c.createdAt)}
                    </span>
                    <Badge variant="secondary" className="font-mono">
                      {c.page.path}
                    </Badge>
                    <Badge variant="outline">{hostOf(c.page.origin)}</Badge>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    On <code className="font-mono">&lt;{c.anchor.tag}&gt;</code>
                    {c.anchor.text ? ` "${c.anchor.text}"` : ""} ·{" "}
                    {c.viewport.w}×{c.viewport.h}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <a
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                      href={jumpUrl(c.page, c._id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLinkIcon /> Jump to comment
                    </a>
                    {c.status === "open" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resolve({ id: c._id })}
                      >
                        <CheckIcon /> Resolve
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reopen({ id: c._id })}
                      >
                        <RotateCcwIcon /> Reopen
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-destructive"
                      onClick={() => {
                        if (
                          confirm("Delete this comment? This can't be undone.")
                        )
                          void remove({ id: c._id })
                      }}
                    >
                      <Trash2Icon /> Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {loadStatus === "CanLoadMore" && (
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => loadMore(50)}
        >
          Load more
        </Button>
      )}
      {loadStatus === "LoadingMore" && <Skeleton className="h-10 w-32" />}
    </div>
  )
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}
