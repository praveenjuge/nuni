"use client"

import { api } from "@nuni/backend/api"
import { LIMITS, type OwnerComment } from "@nuni/shared"
import { cn } from "cn"
import { usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs } from "convex/server"
import {
  FileIcon,
  InboxIcon,
  MessageSquareIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from "vadivam-react"
import { useMemo, useState, type KeyboardEvent } from "react"

import {
  COMMENT_ACTIONS,
  useCommentActions,
  type CommentAction,
} from "@/components/comment-actions"
import { CommentDetail } from "@/components/comment-detail"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { useProject } from "@/components/project-shell"
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
import { useDebounced } from "@/hooks/use-debounced"
import { useMediaQuery } from "@/hooks/use-media-query"
import { hostOf, initials, plural, timeAgo } from "@/lib/format"

type View = FunctionArgs<typeof api.comments.listForOwner>["view"]

/** The inbox tabs. */
const VIEWS: Record<
  View,
  {
    tab: string
    list: string
    /** The bulk action for what is picked here (delete is always offered). */
    action: CommentAction
    /** Show the tab only while it has comments or is open. */
    optional?: boolean
    /** The count is only known up to this many. */
    countMax?: number
    empty: { title: string; description: string }
  }
> = {
  open: {
    tab: "Open",
    list: "Open comments",
    action: "resolve",
    empty: {
      title: "All caught up",
      description: "New comments from your site show up here as they come in.",
    },
  },
  lost: {
    tab: "Not found",
    list: "Comments not found on their page",
    action: "outdated",
    optional: true,
    countMax: LIMITS.lostCountMax,
    empty: {
      title: "Every pin was found",
      description:
        "Open comments whose element is no longer on the page show up here.",
    },
  },
  resolved: {
    tab: "Resolved",
    list: "Resolved comments",
    action: "reopen",
    empty: {
      title: "Nothing resolved yet",
      description: "Comments you resolve are kept here.",
    },
  },
}

const PAGE_SIZE = 50

type Filters = { path?: string; origin?: string; search?: string }

export function ProjectView() {
  const project = useProject()
  const { publicId } = project
  const lostCount = useQuery(api.comments.lostCount, { publicId })
  const choices = useQuery(api.comments.ownerFilters, { publicId })
  const [view, setView] = useState<View>("open")
  const [query, setQuery] = useState("")
  const [pageInput, setPageInput] = useState("")
  const [origin, setOrigin] = useState("")
  const search = useDebounced(query.trim(), 250)
  const path = useDebounced(pageInput.trim(), 250)
  const pages = useMemo(() => [...(choices?.paths ?? [])].sort(), [choices])
  const origins = useMemo(() => [...project.origins].sort(), [project.origins])

  const counts: Record<View, number> = {
    open: project.openCount,
    lost: lostCount ?? 0,
    resolved: Math.max(0, project.commentCount - project.openCount),
  }
  const tabs = (Object.keys(VIEWS) as View[]).filter(
    (key) => !VIEWS[key].optional || counts[key] > 0 || key === view
  )
  const filters: Filters = {
    ...(path ? { path } : {}),
    ...(origin ? { origin } : {}),
    ...(search ? { search } : {}),
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            {tabs.map((key) => {
              const { tab, countMax = Infinity } = VIEWS[key]
              return (
                <TabsTrigger key={key} value={key} className="px-3">
                  {tab}{" "}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {" "}
                    {counts[key] > countMax ? `${countMax}+` : counts[key]}
                  </span>
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>
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
              list="nuni-pages"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              aria-label="Filter by page path"
            />
            <InputGroupAddon>
              <FileIcon />
            </InputGroupAddon>
          </InputGroup>
          <datalist id="nuni-pages">
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
      <CommentList
        key={`${view}|${path}|${origin}|${search}`}
        publicId={publicId}
        view={view}
        filters={filters}
        showSite={origins.length > 1}
        onClearFilters={
          pageInput || origin || query
            ? () => {
                setQuery("")
                setPageInput("")
                setOrigin("")
              }
            : undefined
        }
      />
    </div>
  )
}

/** One tab's comments with the given filters; a new list starts fresh. */
function CommentList({
  publicId,
  view,
  filters,
  showSite,
  onClearFilters,
}: {
  publicId: string
  view: View
  filters: Filters
  showSite: boolean
  /** Set while any filter is on. */
  onClearFilters?: () => void
}) {
  // Filtering happens on the server, so it covers comments not loaded yet.
  const { results, status, loadMore } = usePaginatedQuery(
    api.comments.listForOwner,
    { publicId, view, ...filters },
    { initialNumItems: PAGE_SIZE }
  )
  const { run, busy } = useCommentActions()
  const isDesktop = useMediaQuery("(min-width: 64rem)")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  // When the comment in the detail panel leaves the list (resolved,
  // deleted), the one that took its place is shown, for quick triage.
  const [active, setActive] = useState({ id: "", index: 0 })
  const [sheetOpen, setSheetOpen] = useState(false)

  if (status === "LoadingFirstPage") {
    return <Skeleton className="h-72 rounded-3xl" />
  }

  const list = results
  if (list.length === 0) {
    const empty = onClearFilters
      ? {
          title: "No comments match",
          description: "Try another search, page or site.",
        }
      : VIEWS[view].empty
    return (
      <Card className="py-0">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {onClearFilters ? <SearchIcon /> : <InboxIcon />}
            </EmptyMedia>
            <EmptyTitle className="text-base">{empty.title}</EmptyTitle>
            <EmptyDescription>{empty.description}</EmptyDescription>
          </EmptyHeader>
          {onClearFilters && (
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              Clear filters
            </Button>
          )}
        </Empty>
      </Card>
    )
  }

  // Only what is still listed counts (a comment may be gone meanwhile).
  const picked = list.filter((c) => selected.has(c._id))
  const selectable = list.slice(0, LIMITS.bulkMax)
  const allPicked =
    selectable.length > 0 && selectable.every((c) => selected.has(c._id))
  const found = list.findIndex((c) => c._id === active.id)
  const activeIndex =
    found >= 0 ? found : Math.min(active.index, list.length - 1)
  const current: OwnerComment | undefined = list[activeIndex]
  const bulk = COMMENT_ACTIONS[VIEWS[view].action]

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

  async function runBulk(action: CommentAction) {
    const ids = picked.slice(0, LIMITS.bulkMax).map((c) => c._id)
    if (ids.length && (await run(action, ids))) setSelected(new Set())
  }

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

  return (
    <>
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
                {status === "CanLoadMore" ? "+" : ""}
              </span>
            ) : (
              <>
                <span className="text-sm font-medium tabular-nums">
                  {picked.length} selected
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void runBulk(VIEWS[view].action)}
                  >
                    <bulk.icon /> {bulk.label}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    aria-label="Delete selected"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <TrashIcon />
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
            aria-label={VIEWS[view].list}
            onKeyDown={onListKey}
          >
            {list.map((c, index) => (
              <CommentRow
                key={c._id}
                comment={c}
                showSite={showSite}
                active={isDesktop && index === activeIndex}
                checked={selected.has(c._id)}
                selecting={picked.length > 0}
                onToggle={() => toggle(c._id)}
                onOpen={() => show(index)}
              />
            ))}
          </ul>
          {status === "CanLoadMore" && (
            <div className="border-t p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => loadMore(PAGE_SIZE)}
              >
                Load more
              </Button>
            </div>
          )}
          {status === "LoadingMore" && (
            <div className="border-t p-3">
              <Skeleton className="h-7" />
            </div>
          )}
        </Card>
        {isDesktop && current && (
          <Card className="sticky top-20 max-h-[calc(100svh-6rem)] overflow-y-auto px-6 py-6">
            <CommentDetail key={current._id} comment={current} />
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
                comment={current}
                onChanged={() => setSheetOpen(false)}
              />
            )}
          </SheetContent>
        </Sheet>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${plural(Math.min(picked.length, LIMITS.bulkMax), "comment")}?`}
        description={`They're deleted for everyone, with their replies and screenshots. This can't be undone.${picked.length > LIMITS.bulkMax ? ` Only the first ${LIMITS.bulkMax} are deleted at a time.` : ""}`}
        action="Delete"
        destructive
        onConfirm={() => void runBulk("delete")}
      />
    </>
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
          {c.status === "open" && c.pinLostAt && (
            <span className="font-sans">
              {" "}
              · not found {timeAgo(c.pinLostAt)}
            </span>
          )}
          {c.resolution === "outdated" && (
            <span className="font-sans"> · outdated</span>
          )}
        </span>
      </button>
    </li>
  )
}
