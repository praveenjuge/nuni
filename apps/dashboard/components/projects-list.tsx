"use client"

import { api } from "@nuni/backend/api"
import { DOCS_URL } from "@nuni/shared"
import { useQuery } from "convex/react"
import { ArrowRightIcon, MessageSquareIcon } from "lucide-react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useStoreUser } from "@/components/use-store-user"
import { hostOf, timeAgo } from "@/lib/format"

export function ProjectsList() {
  const { ready } = useStoreUser()
  const projects = useQuery(api.projects.listMine, ready ? {} : "skip")

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="text-sm text-muted-foreground">Sites you have claimed. Comments update live.</p>
      </div>
      {projects === undefined ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-32 rounded-3xl" />
          <Skeleton className="h-32 rounded-3xl" />
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No projects yet</CardTitle>
            <CardDescription>
              Add Nuni to a site, open it, click the Nuni button and choose &ldquo;Claim Nuni&rdquo;. It
              will show up here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <a href={`${DOCS_URL}/quickstart`} className="text-sm font-medium text-primary hover:underline">
              Read the quickstart
            </a>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <Link key={p._id} href={`/p/${p.publicId}`} className="group">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {p.name}
                    <ArrowRightIcon className="ml-auto size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </CardTitle>
                  <CardDescription className="truncate">
                    {p.origins.slice(0, 3).map(hostOf).join(" · ")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2 text-sm">
                  <Badge variant={p.openCount ? "default" : "secondary"}>
                    <MessageSquareIcon />
                    {p.openCount} open
                  </Badge>
                  <span className="text-muted-foreground">{p.commentCount} total</span>
                  <span className="ml-auto text-xs text-muted-foreground">{timeAgo(p.lastActivityAt)}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
