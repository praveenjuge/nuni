"use client"

import type { CommentContext as Context } from "@nuni/shared"
import Image from "next/image"
import type { ReactNode } from "react"

/** The screenshot and captured page context of one comment (owner only). */
export function CommentContext({
  context,
  screenshotUrl,
  userAgent,
}: {
  context?: Context
  screenshotUrl?: string | null
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

  return (
    <>
      {screenshotUrl && (
        <a
          href={screenshotUrl}
          target="_blank"
          rel="noreferrer"
          className="block w-fit max-w-full overflow-hidden rounded-lg border bg-muted"
          title="Open the screenshot"
        >
          <Image
            src={screenshotUrl}
            alt="Screenshot taken when the comment was left"
            width={320}
            height={180}
            unoptimized
            className="h-auto max-h-44 w-80 max-w-full object-cover object-top"
          />
        </a>
      )}
      {hasDetails && (
        <details className="text-xs">
          <summary className="w-fit cursor-pointer text-muted-foreground select-none hover:text-foreground">
            Page context
            {logs.length > 0 && ` · ${logs.length} console`}
            {requests.length > 0 && ` · ${requests.length} failed requests`}
          </summary>
          <div className="mt-2 grid gap-3">
            {logs.length > 0 && (
              <Section title="Console">
                <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono whitespace-pre-wrap">
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
                <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono whitespace-pre-wrap">
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
          </div>
        </details>
      )}
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1">
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  )
}
