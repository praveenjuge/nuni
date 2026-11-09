import {
  LIMITS,
  stripHtmlUrlQueries,
  stripUrlQueries,
  withoutQuery,
  type Anchor,
  type AnchorAncestor,
  type AnchorQuote,
  type CommentContext,
  type PageInfo,
  type Rect,
  type TextSuggestion,
} from "@nuni/shared"

import { clampString, cleanBody, fail, parseOrigin } from "./lib"
import { SERVER_LIMITS } from "./limits"

/**
 * What a widget sends with a comment, checked and clamped before it is
 * stored. Anyone can call the endpoint directly, so nothing here trusts the
 * widget to have done it.
 */

/**
 * The key comments are stored and listed by. Every lookup by path goes
 * through it, so a path longer than the stored one still matches.
 */
export function pageKey(path: string) {
  return clampString(path, SERVER_LIMITS.pagePartMaxLength)
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function cleanPage(page: PageInfo): PageInfo {
  const origin = parseOrigin(page.origin)
  if (originOf(page.url) !== origin) {
    fail("invalid_page", "Page URL does not match its origin")
  }
  // The stored path is joined to a visitor's origin by plain string
  // concatenation and parsed as a URL ("Other pages" links). Opaque
  // custom keys from a site's getPageKey (e.g. "product-123") are fine:
  // the widget only renders same-origin links. Reject the prefixes that
  // would continue or replace the host at click time (".evil.com/x",
  // "@evil.com/", "\\evil.com", "//evil.com/x", "/\\evil.com").
  // Leading whitespace is stripped again by the URL parser, so check
  // the trimmed form too ("\t@evil.example" would otherwise slip by).
  const path = page.path.trimStart()
  if (
    path.startsWith(".") ||
    path.startsWith("@") ||
    path.startsWith("\\") ||
    path.startsWith("//") ||
    path.startsWith("/\\")
  ) {
    fail("invalid_page", "Page path must not continue the host")
  }
  return {
    origin,
    title: clampString(page.title, SERVER_LIMITS.pageTitleMaxLength),
    url: clampString(page.url, SERVER_LIMITS.pageUrlMaxLength),
    search: clampString(page.search, SERVER_LIMITS.pagePartMaxLength),
    hash: clampString(page.hash, SERVER_LIMITS.pagePartMaxLength),
    path: pageKey(page.path),
  }
}

/**
 * Query strings and hashes are removed here too, not only by the widget,
 * since they may hold secrets.
 */
export function cleanContext(context: CommentContext | undefined) {
  if (!context) return undefined
  const max = LIMITS.contextEntryMax
  const text = (value: string) =>
    clampString(value, LIMITS.contextMessageMaxLength)
  const out: CommentContext = {}
  if (context.console?.length) {
    out.console = context.console.slice(-max).map((e) => ({
      level: e.level,
      message: text(stripUrlQueries(e.message)),
      at: e.at,
    }))
  }
  if (context.network?.length) {
    out.network = context.network.slice(-max).map((e) => ({
      method: clampString(
        e.method.toUpperCase(),
        SERVER_LIMITS.methodMaxLength
      ),
      url: text(withoutQuery(e.url)),
      status: Math.trunc(e.status),
      at: e.at,
    }))
  }
  if (context.dom) {
    const styles: Record<string, string> = {}
    for (const [name, value] of Object.entries(context.dom.styles).slice(
      0,
      SERVER_LIMITS.stylesMax
    )) {
      styles[clampString(name, SERVER_LIMITS.styleNameMaxLength)] = clampString(
        stripUrlQueries(value),
        SERVER_LIMITS.styleValueMaxLength
      )
    }
    out.dom = {
      html: clampString(
        stripHtmlUrlQueries(context.dom.html),
        LIMITS.domSnippetMaxLength
      ),
      styles,
    }
  }
  return out.console || out.network || out.dom ? out : undefined
}

/**
 * The words a suggestion replaces must be the commented text itself: the
 * selected words, or the whole text of a small element like a button.
 */
export function cleanSuggestion(
  suggestion: TextSuggestion | undefined,
  anchor: Pick<Anchor, "text" | "quote" | "region">
) {
  if (!suggestion) return undefined
  const before = suggestion.before.trim()
  const after = suggestion.after.replace(/\r\n/g, "\n").trim()
  const target = anchor.quote
    ? anchor.quote.exact
    : anchor.region
      ? ""
      : anchor.text
  if (!before || before !== target) {
    fail("invalid_suggestion", "A suggestion has to change the commented text")
  }
  if (!after || after === before) {
    fail("invalid_suggestion", "Change the text to suggest an edit")
  }
  if (after.length > LIMITS.quoteMaxLength) {
    fail(
      "invalid_suggestion",
      `Suggestions are limited to ${LIMITS.quoteMaxLength} characters`
    )
  }
  return { before, after }
}

/** The comment text: may be empty when the suggestion says it all. */
export function cleanCommentBody(body: string, hasSuggestion: boolean) {
  return hasSuggestion && !body.trim() ? "" : cleanBody(body)
}

function cleanQuote(quote: AnchorQuote | undefined): AnchorQuote | undefined {
  const exact = clampString(quote?.exact.trim() ?? "", LIMITS.quoteMaxLength)
  if (!quote || !exact) return undefined
  return {
    exact,
    prefix: clampString(quote.prefix, LIMITS.quoteContextLength),
    suffix: clampString(quote.suffix, LIMITS.quoteContextLength),
  }
}

/** An area inside the element, kept to 0..1 of its box. */
function cleanRegion(r: Rect): Rect {
  const unit = (n: number) =>
    Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
  const x = unit(r.x)
  const y = unit(r.y)
  return { x, y, w: Math.min(unit(r.w), 1 - x), h: Math.min(unit(r.h), 1 - y) }
}

function cleanAncestor(ancestor: AnchorAncestor): AnchorAncestor {
  return ancestor.text === undefined
    ? ancestor
    : {
        ...ancestor,
        text: clampString(ancestor.text, LIMITS.anchorAncestorTextMaxLength),
      }
}

/** The text and ancestors of one element, as long as `@nuni/anchor` keeps them. */
function cleanElement<A extends Pick<Anchor, "text" | "ancestors">>(
  anchor: A
): A {
  return {
    ...anchor,
    text: clampString(anchor.text, LIMITS.anchorTextMaxLength),
    ancestors: anchor.ancestors
      .slice(0, LIMITS.anchorAncestorsMax)
      .map(cleanAncestor),
  }
}

/**
 * A whole anchor, with every part within its limits. Like `@nuni/anchor`, a
 * scope chain that is too deep keeps its innermost steps.
 */
export function cleanAnchor(anchor: Anchor): Anchor {
  return {
    ...cleanElement(anchor),
    scope: anchor.scope?.slice(-LIMITS.anchorScopeMaxDepth).map((step) => ({
      kind: step.kind,
      host: cleanElement(step.host),
    })),
    quote: cleanQuote(anchor.quote),
    region: anchor.region && cleanRegion(anchor.region),
  }
}
