"use client"

import { api } from "@nuni/backend/api"
import { DOCS_URL } from "@nuni/shared"
import { useQuery } from "convex/react"
import { ArrowRightIcon, FolderOpenIcon, MessageSquareIcon } from "lucide-react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useStoreUser } from "@/components/use-store-user"
import { hostOf, timeAgo } from "@/lib/format"

export function ProjectsList() {
  const { ready } = useStoreUser()
  const projects = useQuery(api.projects.listMine, ready ? {} : "skip")

  return (
    <section className="grid gap-8" aria-labelledby="projects-heading">
      <h1
        id="projects-heading"
        className="text-2xl font-semibold tracking-tight"
      >
        Projects
      </h1>
      {projects === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-40 rounded-3xl" />
          <Skeleton className="h-40 rounded-3xl" />
        </div>
      ) : projects.length === 0 ? (
        <Card className="items-center gap-4 py-10 text-center shadow-none">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <FolderOpenIcon className="size-5" aria-hidden="true" />
          </div>
          <CardHeader className="w-full gap-1.5 text-center">
            <CardTitle>No projects yet</CardTitle>
            <CardDescription>
              Add Nuni to your site, then claim it from the widget.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <a
              href={`${DOCS_URL}/quickstart`}
              className={buttonVariants({ size: "sm" })}
            >
              Add Nuni to a site <ArrowRightIcon aria-hidden="true" />
            </a>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <Link
              key={p._id}
              href={`/p/${p.publicId}`}
              className="group rounded-3xl outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <Card
                size="sm"
                className="h-full transition-shadow group-hover:shadow-md"
              >
                <CardHeader>
                  <CardTitle className="truncate">{p.name}</CardTitle>
                  <CardDescription className="truncate">
                    {p.origins.slice(0, 3).map(hostOf).join(" · ")}
                  </CardDescription>
                  <CardAction>
                    <ArrowRightIcon
                      className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </CardAction>
                </CardHeader>
                <CardContent className="flex items-center gap-2 text-sm">
                  <Badge variant={p.openCount ? "default" : "secondary"}>
                    <MessageSquareIcon aria-hidden="true" />
                    {p.openCount} open
                  </Badge>
                  <span className="text-muted-foreground">
                    {p.commentCount} total
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {timeAgo(p.lastActivityAt)}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
