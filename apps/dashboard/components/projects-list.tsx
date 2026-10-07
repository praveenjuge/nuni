"use client"

import { api } from "@nuni/backend/api"
import { useQuery } from "convex/react"
import { ChevronRightIcon } from "lucide-react"
import Link from "next/link"

import { NewProjectDialog, SetupSteps } from "@/components/setup-steps"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useStoreUser } from "@/components/use-store-user"
import { hostOf, plural, timeAgo } from "@/lib/format"

export function ProjectsList() {
  const { ready } = useStoreUser()
  const projects = useQuery(api.projects.listMine, ready ? {} : "skip")

  return (
    <section className="grid gap-6" aria-labelledby="projects-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1
            id="projects-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Projects
          </h1>
          <p className="text-sm text-muted-foreground">
            Every site where you&apos;ve claimed Nuni.
          </p>
        </div>
        {projects && projects.length > 0 && <NewProjectDialog />}
      </div>
      {projects === undefined ? (
        <Card className="gap-0 py-0">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <Skeleton className="size-9 rounded-xl" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
          ))}
        </Card>
      ) : projects.length === 0 ? (
        <Card className="mx-auto w-full max-w-lg gap-6 px-6 py-8">
          <div className="grid gap-1">
            <h2 className="text-base font-medium">
              Add Nuni to your first site
            </h2>
            <p className="text-sm text-muted-foreground">
              Projects appear here once you claim them. Commenters never need an
              account.
            </p>
          </div>
          <SetupSteps />
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {projects.map((p) => {
              const hosts = p.origins.map(hostOf)
              const meta = [
                hosts.length === 1 && hosts[0] === p.name
                  ? null
                  : hosts.slice(0, 2).join(", ") +
                    (hosts.length > 2 ? ` +${hosts.length - 2}` : ""),
                plural(p.commentCount, "comment"),
                `active ${timeAgo(p.lastActivityAt)}`,
              ].filter(Boolean)
              return (
                <li key={p._id}>
                  <Link
                    href={`/p/${p.publicId}`}
                    className="group flex items-center gap-4 px-4 py-3.5 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
                  >
                    <ProjectMark name={p.name} />
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="truncate text-sm text-muted-foreground">
                        {meta.join(" · ")}
                      </span>
                    </div>
                    <Badge variant={p.openCount ? "default" : "secondary"}>
                      {p.openCount} open
                    </Badge>
                    <ChevronRightIcon
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </section>
  )
}

/** A quiet monogram so projects are easy to tell apart at a glance. */
function ProjectMark({ name }: { name: string }) {
  const letter = name.match(/[a-z0-9]/i)?.[0]?.toUpperCase() ?? "#"
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-muted-foreground ring-1 ring-foreground/5"
    >
      {letter}
    </span>
  )
}
