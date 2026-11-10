"use client"

import { api } from "@nuni/backend/api"
import { projectRoute } from "@nuni/shared"
import { cn } from "cn"
import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { ArrowUpRightIcon, ChevronLeftIcon, InboxIcon } from "vadivam-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { createContext, useContext, type ReactNode } from "react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { hostOf } from "@/lib/format"

export type OwnedProject = NonNullable<
  FunctionReturnType<typeof api.projects.getMine>
>

const ProjectContext = createContext<OwnedProject | null>(null)

/** The project whose pages these are. Only inside `ProjectShell`. */
export function useProject(): OwnedProject {
  const project = useContext(ProjectContext)
  if (!project) throw new Error("useProject is only for ProjectShell pages")
  return project
}

/** A project's pages: the project loaded once, its header and its tabs. */
export function ProjectShell({
  publicId,
  children,
}: {
  publicId: string
  children: ReactNode
}) {
  const project = useQuery(api.projects.getMine, { publicId })
  if (project === undefined) return <ProjectSkeleton />
  if (project === null) return <ProjectNotFound />
  return (
    <ProjectContext value={project}>
      <div className="grid gap-6">
        <ProjectHeader project={project} />
        {children}
      </div>
    </ProjectContext>
  )
}

function tabs(publicId: string) {
  const base = projectRoute(publicId)
  return [
    { label: "Comments", href: base },
    { label: "Settings", href: `${base}/settings` },
  ]
}

function ProjectHeader({ project }: { project: OwnedProject }) {
  const pathname = usePathname()
  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <Link
          href="/"
          className="flex w-fit items-center gap-0.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <ChevronLeftIcon className="size-4" aria-hidden="true" /> Projects
        </Link>
        <h1 className="truncate text-2xl font-semibold tracking-tight">
          {project.name}
        </h1>
        {project.origins.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {project.origins.map((origin) => (
              <li key={origin}>
                <a
                  href={origin}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 rounded-md outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  {hostOf(origin)}
                  <ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <nav aria-label="Project" className="flex gap-5 border-b">
        {tabs(project.publicId).map(({ label, href }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative -mb-px border-b-2 pb-2.5 text-sm font-medium outline-none focus-visible:text-foreground",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
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

function ProjectNotFound() {
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
