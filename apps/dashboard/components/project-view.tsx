"use client"

import { api } from "@nuni/backend/api"
import { LIMITS } from "@nuni/shared"
import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import {
  CheckIcon,
  FileIcon,
  InboxIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import Link from "next/link"
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react"
import { toast } from "sonner"

import { CommentDetail, type OwnerComment } from "@/components/comment-detail"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ProjectHeader } from "@/components/project-header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useStoreUser } from "@/components/use-store-user"
import { errorMessage, hostOf, initials, plural, timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"

type Status = "open" | "resolved"

export function ProjectView({ publicId }: { publicId: string }) {
  const { ready } = useStoreUser()
  const project = useQuery(api.projects.getMine, ready ? { publicId } : "skip")
  const [status, setStatus] = useState<Status>("open")

  if (!ready || project === undefined) return <ProjectSkeleton />
  if (project === null) return <ProjectNotFound />

  const resolvedCount = Math.max(0, project.commentCount - project.openCount)
  return (
    <div className="grid gap-6">
      <ProjectHeader project={project} current="comments" />
      <CommentList
        publicId={publicId}
        status={status}
        tabs={
          <Tabs value={status} onValueChange={(v) => setStatus(v as Status)}>
            <TabsList>
              <TabsTrigger value="open" className="px-3">
                Open <Count n={project.openCount} />
              </TabsTrigger>
              <TabsTrigger value="resolved" className="px-3">
                Resolved <Count n={resolvedCount} />
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
    </div>
  )
}

function Count({ n }: { n: number }) {
  return (
    <span className="text-xs text-muted-foreground tabular-nums"> {n}</span>
  )
}

function CommentList({
  publicId,
  status,
  tabs,
}: {
  publicId: string
  status: Status
  tabs: React.ReactNode
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
  const bulkSetStatus = useMutation(api.comments.bulkSetStatus)
  const bulkRemove = useMutation(api.comments.bulkRemove)
  const isDesktop = useMediaQuery("(min-width: 64rem)")

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  // The comment in the detail panel. When it leaves the list (resolved,
  // deleted), the one that took its place is shown, for quick triage.
  const [active, setActive] = useState({ id: "", index: 0 })
  const [sheetOpen, setSheetOpen] = useState(false)
  // A different list (tab or filters): start over.
  const listKey = `${status}|${page}|${origin}|${search}`
  const [listFor, setListFor] = useState(listKey)
  if (listFor !== listKey) {
    setListFor(listKey)
    setSelected(new Set())
    setActive({ id: "", index: 0 })
  }

  const pages = useMemo(() => [...(filters?.paths ?? [])].sort(), [filters])
  const origins = useMemo(() => [...(filters?.origins ?? [])].sort(), [filters])
  const list = comments ?? []
  const hasFilters = Boolean(pageInput || origin || query)
  // Only what is still listed counts (a comment may be gone meanwhile).
  const picked = list.filter((c) => selected.has(c._id))
  // Bulk actions take at most LIMITS.bulkMax at once, so "all" means that many.
  const selectable = list.slice(0, LIMITS.bulkMax)
  const allPicked =
    selectable.length > 0 && selectable.every((c) => selected.has(c._id))
  const found = list.findIndex((c) => c._id === active.id)
  const activeIndex =
    found >= 0 ? found : Math.min(active.index, list.length - 1)
  const current: OwnerComment | undefined = list[activeIndex]

  function show(index: number) {
    const c = list[index]
    if (!c) return
    setActive({ id: c._id, index })
    if (!isDesktop) setSheetOpen(true)
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function runBulk(action: "resolve" | "reopen" | "delete") {
    const ids = picked.slice(0, LIMITS.bulkMax).map((c) => c._id)
    if (!ids.length) return
    setBulkBusy(true)
    try {
      if (action === "delete") await bulkRemove({ ids })
      else
        await bulkSetStatus({
          ids,
          status: action === "resolve" ? "resolved" : "open",
        })
      setSelected(new Set())
      toast(
        `${plural(ids.length, "comment")} ${action === "delete" ? "deleted" : action === "resolve" ? "resolved" : "reopened"}`
      )
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBulkBusy(false)
    }
  }

  // Up and down move through the list, like an inbox.
  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    const rows = [
      ...e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-row]"),
    ]
    const at = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    e.preventDefault()
    const next = Math.max(
      0,
      Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1))
    )
    rows[next]?.focus()
    if (isDesktop) show(next)
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {tabs}
      <div className="ml-auto flex w-full flex-wrap gap-2 sm:w-auto">
        <InputGroup className="sm:w-56">
          <InputGroupInput
            placeholder="Search comments"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search comments"
          />
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
        </InputGroup>
        {/* Free text with suggestions, so paths beyond the suggestion list still work. */}
        <InputGroup className="flex-1 sm:w-44 sm:flex-none">
          <InputGroupInput
            placeholder="All pages"
            list={`nuni-pages-${status}`}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            aria-label="Filter by page path"
          />
          <InputGroupAddon>
            <FileIcon />
          </InputGroupAddon>
        </InputGroup>
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
              <SelectItem value="all">All sites</SelectItem>
              {origins.map((o) => (
                <SelectItem key={o} value={o}>
                  {hostOf(o)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  )

  if (comments === undefined) {
    return (
      <div className="grid gap-4">
        {toolbar}
        <Skeleton className="h-72 rounded-3xl" />
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <div className="grid gap-4">
        {toolbar}
        <Card className="py-0">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {hasFilters ? <SearchIcon /> : <InboxIcon />}
              </EmptyMedia>
              <EmptyTitle className="text-base">
                {hasFilters
                  ? "No comments match"
                  : status === "open"
                    ? "All caught up"
                    : "Nothing resolved yet"}
              </EmptyTitle>
              <EmptyDescription>
                {hasFilters
                  ? "Try another search, page or site."
                  : status === "open"
                    ? "New comments from your site show up here as they come in."
                    : "Comments you resolve are kept here."}
              </EmptyDescription>
            </EmptyHeader>
            {hasFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("")
                  setPageInput("")
                  setOrigin("")
                }}
              >
                Clear filters
              </Button>
            )}
          </Empty>
        </Card>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      {toolbar}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card className="gap-0 py-0">
          <div
            role="toolbar"
            aria-label="Bulk actions"
            className="flex h-12 items-center gap-3 border-b px-4"
          >
            <Checkbox
              checked={allPicked}
              indeterminate={picked.length > 0 && !allPicked}
              onCheckedChange={() =>
                setSelected(
                  allPicked ? new Set() : new Set(selectable.map((c) => c._id))
                )
              }
              aria-label="Select all comments shown"
            />
            {picked.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                {plural(list.length, "comment")}
                {loadStatus === "CanLoadMore" ? "+" : ""}
              </span>
            ) : (
              <>
                <span className="text-sm font-medium tabular-nums">
                  {picked.length} selected
                </span>
                <div className="ml-auto flex items-center gap-1">
                  {status === "open" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={bulkBusy}
                      onClick={() => void runBulk("resolve")}
                    >
                      <CheckIcon /> Resolve
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={bulkBusy}
                      onClick={() => void runBulk("reopen")}
                    >
                      <RotateCcwIcon /> Reopen
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={bulkBusy}
                    aria-label="Delete selected"
                    onClick={() => setConfirmBulkDelete(true)}
                  >
                    <Trash2Icon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Clear the selection"
                    onClick={() => setSelected(new Set())}
                  >
                    <XIcon />
                  </Button>
                </div>
              </>
            )}
          </div>
          <ul
            className="divide-y"
            aria-label={
              status === "open" ? "Open comments" : "Resolved comments"
            }
            onKeyDown={onListKey}
          >
            {list.map((c, index) => (
              <CommentRow
                key={c._id}
                comment={c}
                showSite={origins.length > 1}
                active={isDesktop && index === activeIndex}
                checked={selected.has(c._id)}
                selecting={picked.length > 0}
                onToggle={() => toggle(c._id)}
                onOpen={() => show(index)}
              />
            ))}
          </ul>
          {loadStatus === "CanLoadMore" && (
            <div className="border-t p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => loadMore(50)}
              >
                Load more
              </Button>
            </div>
          )}
          {loadStatus === "LoadingMore" && (
            <div className="border-t p-3">
              <Skeleton className="h-7" />
            </div>
          )}
        </Card>
        {isDesktop && current && (
          <Card className="sticky top-20 max-h-[calc(100svh-6rem)] overflow-y-auto px-6 py-6">
            <CommentDetail
              key={current._id}
              publicId={publicId}
              comment={current}
            />
          </Card>
        )}
      </div>
      {!isDesktop && (
        <Sheet open={sheetOpen && Boolean(current)} onOpenChange={setSheetOpen}>
          <SheetContent className="w-full overflow-y-auto p-5 pt-14 data-[side=right]:sm:max-w-lg">
            <SheetTitle className="sr-only">Comment</SheetTitle>
            {current && (
              <CommentDetail
                key={current._id}
                publicId={publicId}
                comment={current}
                onChanged={() => setSheetOpen(false)}
              />
            )}
          </SheetContent>
        </Sheet>
      )}
      <ConfirmDialog
        open={confirmBulkDelete}
        onOpenChange={setConfirmBulkDelete}
        title={`Delete ${plural(Math.min(picked.length, LIMITS.bulkMax), "comment")}?`}
        description={`They're deleted for everyone, with their replies and screenshots. This can't be undone.${picked.length > LIMITS.bulkMax ? ` Only the first ${LIMITS.bulkMax} are deleted at a time.` : ""}`}
        action="Delete"
        destructive
        onConfirm={() => void runBulk("delete")}
      />
    </div>
  )
}

function CommentRow({
  comment: c,
  showSite,
  active,
  checked,
  selecting,
  onToggle,
  onOpen,
}: {
  comment: OwnerComment
  showSite: boolean
  active: boolean
  checked: boolean
  selecting: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  return (
    <li
      className={cn(
        "group/row relative flex gap-3 px-4 py-3 transition-colors",
        active ? "bg-muted/70" : "hover:bg-muted/40"
      )}
    >
      {/* The avatar turns into a checkbox on hover, or while selecting. */}
      <div className="relative z-10 grid size-6 shrink-0 place-items-center">
        <Avatar
          size="sm"
          className={cn(
            "transition-opacity group-focus-within/row:opacity-0 group-hover/row:opacity-0",
            (selecting || checked) && "opacity-0"
          )}
        >
          <AvatarFallback className="bg-primary/10 font-medium text-primary">
            {initials(c.authorName)}
          </AvatarFallback>
        </Avatar>
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          aria-label={`Select the comment by ${c.authorName}`}
          className={cn(
            "absolute opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100",
            (selecting || checked) && "opacity-100"
          )}
        />
      </div>
      <button
        type="button"
        data-row
        aria-current={active ? "true" : undefined}
        onClick={onOpen}
        className="grid min-w-0 flex-1 gap-1 text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/30 focus-visible:after:ring-inset"
      >
        <span className="flex min-h-6 items-center gap-2 text-sm">
          <span className="truncate font-medium">{c.authorName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {timeAgo(c.createdAt)}
          </span>
          {c.replies.length > 0 && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
              <MessageSquareIcon className="size-3.5" aria-hidden="true" />
              {c.replies.length}
              <span className="sr-only">
                {c.replies.length === 1 ? "reply" : "replies"}
              </span>
            </span>
          )}
        </span>
        <span className="line-clamp-2 text-sm text-foreground/80">
          {c.suggestion && (
            <>
              <del className="text-muted-foreground">{c.suggestion.before}</del>
              {" → "}
              <ins className="no-underline">{c.suggestion.after}</ins>
              {c.body && " · "}
            </>
          )}
          {c.body}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {showSite ? hostOf(c.page.origin) : ""}
          {c.page.path}
        </span>
      </button>
    </li>
  )
}

function ProjectSkeleton() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-72 rounded-3xl" />
    </div>
  )
}

export function ProjectNotFound() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>Project not found</EmptyTitle>
        <EmptyDescription>
          It doesn&apos;t exist, is being deleted, or belongs to someone else.
          Claim it from the widget on your site first.
        </EmptyDescription>
      </EmptyHeader>
      <Link
        href="/"
        className="text-sm font-medium text-primary hover:underline"
      >
        Back to projects
      </Link>
    </Empty>
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

/** Whether a media query matches; the server renders the desktop layout. */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query)
      media.addEventListener("change", onChange)
      return () => media.removeEventListener("change", onChange)
    },
    () => window.matchMedia(query).matches,
    () => true
  )
}
