import type { Doc } from "@nuni/backend/dataModel"
import { ArrowUpRightIcon, ChevronLeftIcon } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import { hostOf } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Name, sites and the Comments / Settings tabs, shared by both project pages. */
export function ProjectHeader({
  project,
  current,
}: {
  project: Doc<"projects">
  current: "comments" | "settings"
}) {
  const base = `/p/${project.publicId}`
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
        <Tab href={base} active={current === "comments"}>
          Comments
        </Tab>
        <Tab href={`${base}/settings`} active={current === "settings"}>
          Settings
        </Tab>
      </nav>
    </div>
  )
}

function Tab({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative -mb-px border-b-2 pb-2.5 text-sm font-medium outline-none focus-visible:text-foreground",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Link>
  )
}
