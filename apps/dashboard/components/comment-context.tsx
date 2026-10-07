"use client"

import type { CommentContext as Context } from "@nuni/shared"
import { ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

/** The page context captured with one comment (owner only), folded away until needed. */
export function CommentContext({
  context,
  userAgent,
}: {
  context?: Context
  userAgent?: string
}) {
  const logs = context?.console ?? []
  const requests = context?.network ?? []
  const styles = Object.entries(context?.dom?.styles ?? {})
  const hasDetails =
    logs.length > 0 ||
    requests.length > 0 ||
    Boolean(context?.dom?.html) ||
    Boolean(userAgent)
  if (!hasDetails) return null

  const counts = [
    logs.length > 0 && `${logs.length} console`,
    requests.length > 0 &&
      `${requests.length} failed request${requests.length === 1 ? "" : "s"}`,
  ].filter(Boolean)

  return (
    <Collapsible className="text-xs">
      <CollapsibleTrigger className="group/context flex w-fit items-center gap-1 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30">
        <ChevronRightIcon
          className="size-4 transition-transform group-data-panel-open/context:rotate-90"
          aria-hidden="true"
        />
        Page context
        {counts.length > 0 && (
          <span className="text-xs">· {counts.join(" · ")}</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 grid gap-4 rounded-xl bg-muted/50 p-3">
        {logs.length > 0 && (
          <Section title="Console">
            <pre className="max-h-48 overflow-auto font-mono whitespace-pre-wrap">
              {logs.map((e) => `[${e.level}] ${e.message}`).join("\n")}
            </pre>
          </Section>
        )}
        {requests.length > 0 && (
          <Section title="Failed requests">
            <ul className="grid gap-1 font-mono">
              {requests.map((r, i) => (
                <li key={i} className="break-all">
                  {r.method} {r.url} →{" "}
                  {r.status === 0 ? "network error" : r.status}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {context?.dom?.html && (
          <Section title="Element">
            <pre className="max-h-48 overflow-auto font-mono whitespace-pre-wrap">
              {context.dom.html}
            </pre>
          </Section>
        )}
        {styles.length > 0 && (
          <Section title="Styles">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono">
              {styles.map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="text-muted-foreground">{name}</dt>
                  <dd className="break-all">{value}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}
        {userAgent && (
          <Section title="Browser">
            <p className="font-mono break-all">{userAgent}</p>
          </Section>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="font-medium text-foreground">{title}</h3>
      {children}
    </section>
  )
}
