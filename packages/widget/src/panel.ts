import { pageLink, type WidgetComment } from "@nuni/shared"

import { api, type PageSummary } from "./api"
import { h, icon, isMobile } from "./dom"
import { avatar } from "./identity"
import { ICONS } from "./icons"
import { KEYS, read, write } from "./storage"
import { renderSuggestionLine } from "./suggestion"
import type { Ctx } from "./widget"

/**
 * A link to another page of this site, on this origin and with this page's
 * query (comments are shared across origins, and sites often keep state in
 * the query), opening one comment when given.
 */
function siteLink(path: string, commentId?: string): string | null {
  return pageLink(
    { origin: location.origin, path, search: location.search },
    commentId
  )
}

const TABS = ["open", "resolved", "mine"] as const
type Tab = (typeof TABS)[number]
/** Other pages listed by name only, after those whose comments are shown. */
const OTHER_PAGES_SHOWN = 20

export type Panel = ReturnType<typeof createPanel>

/**
 * The comments list: this page's comments, then every other page's, the
 * visitor's own (Yours), search, and claiming the site.
 */
export function createPanel(ctx: Ctx) {
  const { t } = ctx
  let open = false
  /** Yours and other pages stay subscribed once the panel was opened. */
  let opened = false
  let tab: Tab = "open"
  /** What the search box filters by. */
  let search = ""
  /** The visitor's own comments on every page. */
  let mine: WidgetComment[] | null = null
  /** Comments on every page, grouped by page. */
  let site: WidgetComment[] | null = null
  let pages: PageSummary[] = []
  /** The comment opened last, marked to find your place again. */
  let lastViewed = read(KEYS.lastViewed(ctx.config.project))

  const toggle = (on = !open) => {
    if (on === open) return
    open = on
    if (on) {
      opened = true
      ctx.dialog.keepFocus()
      ctx.dialog.focusAfterRender('.panel [role="tab"][aria-selected="true"]')
      ctx.afterRender(() =>
        ctx.ui
          .querySelector('.panel .item[aria-current="true"]')
          ?.scrollIntoView({ block: "nearest" })
      )
      if (isMobile()) ctx.setCard(null)
    } else search = ""
    ctx.render()
    if (!on && !ctx.card) ctx.dialog.restoreFocus()
  }

  const setTab = (next: Tab) => {
    tab = next
    ctx.render()
  }

  const render = () => {
    const { page } = ctx
    const query = search.trim().toLocaleLowerCase()
    const hit = (...texts: (string | undefined)[]) =>
      !query || texts.some((text) => text?.toLocaleLowerCase().includes(query))
    const found = (c: WidgetComment) =>
      hit(
        c.body,
        c.authorName,
        c.anchor.quote?.exact,
        c.suggestion?.after,
        c.page.path
      )
    const status = tab === "resolved" ? "resolved" : "open"
    const here = (s: WidgetComment["status"]) =>
      page.comments.filter((c) => c.status === s)
    // Other pages' comments, grouped by page, newest page first.
    const elsewhere = (s: WidgetComment["status"]) =>
      (site ?? []).filter((c) => c.page.path !== page.key && c.status === s)
    const list = (tab === "mine" ? (mine ?? []) : here(status)).filter(found)
    const placed = list.filter((c) => ctx.pins.found(c._id))
    const lost = list.filter((c) => !ctx.pins.found(c._id))
    const groups = new Map<string, WidgetComment[]>()
    for (const c of elsewhere(status).filter(found)) {
      groups.set(c.page.path, [...(groups.get(c.page.path) ?? []), c])
    }
    // Pages past the newest comments listed (or before they load): a link.
    const listed = new Set(elsewhere(status).map((c) => c.page.path))
    const otherPages = pages.filter(
      (p) => p.path !== page.key && !listed.has(p.path) && hit(p.path)
    )

    const content = (c: WidgetComment) => [
      c.suggestion
        ? renderSuggestionLine(c.suggestion)
        : c.anchor.quote
          ? h("div", { class: "item-quote" }, c.anchor.quote.exact)
          : null,
      c.body ? h("div", { class: "item-text" }, c.body) : null,
    ]

    // Your own comments: where each one is and whether it was resolved.
    const mineItem = (c: WidgetComment) => {
      const isHere = c.page.path === page.key
      const href = isHere ? null : siteLink(c.page.path, c._id)
      const resolved = c.status === "resolved"
      return h(
        isHere ? "button" : href === null ? "div" : "a",
        isHere
          ? {
              class: "item",
              type: "button",
              "data-focus-key": `item-${c._id}`,
              onclick: () => page.openComment(c._id),
            }
          : { class: "item", href },
        h(
          "div",
          { class: "row" },
          h("span", { class: "author" }, isHere ? t("thisPage") : c.page.path),
          h("span", { class: "meta" }, ctx.i18n.timeAgo(c.createdAt)),
          h("span", { class: "spacer" }),
          h(
            "span",
            { class: resolved ? "badge badge-ok" : "badge" },
            resolved ? icon(ICONS.check) : null,
            t(
              !resolved
                ? "statusOpen"
                : c.resolution === "outdated"
                  ? "outdated"
                  : "resolved"
            )
          )
        ),
        ...content(c)
      )
    }

    // A comment here opens in place; one on another page links there.
    const item = (c: WidgetComment, href?: string | null) =>
      h(
        href === undefined ? "button" : href === null ? "div" : "a",
        {
          class: "item",
          "aria-current": c._id === lastViewed ? "true" : null,
          "data-focus-key": `item-${c._id}`,
          ...(href === undefined
            ? { type: "button", onclick: () => page.openComment(c._id) }
            : { href }),
        },
        h(
          "div",
          { class: "row" },
          ...ctx.identity.authorLine(c),
          h(
            "span",
            { class: "meta" },
            ctx.i18n.timeAgo(c.createdAt) +
              (c.replyCount
                ? ` · ${t("replyCount", { count: c.replyCount })}`
                : "")
          ),
          c.page.origin !== location.origin
            ? h(
                "span",
                { class: "badge", title: c.page.origin },
                new URL(c.page.origin).host
              )
            : null,
          c.resolution === "outdated"
            ? h("span", { class: "badge" }, t("outdated"))
            : null
        ),
        ...content(c)
      )

    const empty = (text: string) => h("div", { class: "empty" }, text)
    const label = (text: string, cls = "section-label") =>
      h("div", { class: cls }, text)
    const noMatches = () => empty(t("noMatches", { query: search.trim() }))

    const children: Node[] = []
    if (tab === "mine") {
      if (!mine) children.push(empty(t("loading")))
      else if (!list.length) {
        children.push(query ? noMatches() : empty(t("noYours")))
      } else children.push(...list.map(mineItem))
    } else if (!page.loaded) {
      children.push(empty(t("loading")))
    } else {
      // This page first, then every other page with its comments.
      const others = groups.size > 0 || otherPages.length > 0
      if (others && (list.length || !query)) children.push(label(t("thisPage")))
      if (list.length) {
        children.push(...placed.map((c) => item(c)))
        if (lost.length) {
          children.push(label(t("notFoundHere")), ...lost.map((c) => item(c)))
        }
      } else if (!query) {
        children.push(
          empty(
            tab === "open"
              ? ctx.withKey("noOpen", "noOpenKey")
              : t("noResolved")
          )
        )
      }
      for (const [path, comments] of groups) {
        children.push(
          label(path, "section-label section-path"),
          ...comments.map((c) => item(c, siteLink(c.page.path, c._id)))
        )
      }
      if (!children.length && !otherPages.length) children.push(noMatches())
    }
    if (otherPages.length && tab !== "mine") {
      children.push(label(t("otherPages")))
      for (const p of otherPages.slice(0, OTHER_PAGES_SHOWN)) {
        const href = siteLink(p.path)
        children.push(
          h(
            href === null ? "div" : "a",
            href === null ? { class: "item" } : { class: "item", href },
            h(
              "div",
              { class: "row" },
              h("span", { class: "author" }, p.path),
              h("span", { class: "spacer" }),
              h("span", { class: "badge" }, t("openOnPage", { count: p.count }))
            )
          )
        )
      }
    }

    return h(
      "div",
      { class: "panel", role: "dialog", "aria-label": t("comments") },
      h(
        "div",
        { class: "panel-head" },
        h("div", { class: "panel-title" }, t("comments")),
        h(
          "button",
          {
            class: "btn btn-ghost btn-icon",
            type: "button",
            "aria-label": t("close"),
            onclick: () => toggle(false),
          },
          icon(ICONS.close)
        )
      ),
      page.comments.length || mine?.length || site?.length
        ? h(
            "div",
            { class: "panel-search" },
            icon(ICONS.search),
            h("input", {
              class: "field",
              type: "search",
              value: search,
              placeholder: t("searchComments"),
              "aria-label": t("searchComments"),
              "aria-controls": "nuni-panel-list",
              "data-focus-key": "panel-search",
              oninput: (e: Event) => {
                search = (e.target as HTMLInputElement).value
                ctx.render()
              },
            })
          )
        : null,
      h(
        "div",
        {
          class: "tabs",
          role: "tablist",
          "aria-label": t("comments"),
          // Arrow keys move between the tabs; Tab moves on to the list.
          onkeydown: (e: Event) => {
            const key = (e as KeyboardEvent).key
            const at = TABS.indexOf(tab)
            const last = TABS.length - 1
            const next =
              key === "Home"
                ? 0
                : key === "End"
                  ? last
                  : key === "ArrowRight"
                    ? (at + 1) % TABS.length
                    : key === "ArrowLeft"
                      ? (at + last) % TABS.length
                      : -1
            if (next < 0) return
            e.preventDefault()
            ctx.dialog.focusAfterRender(`[data-focus-key="tab-${TABS[next]}"]`)
            setTab(TABS[next]!)
          },
        },
        TABS.map((name) =>
          h(
            "button",
            {
              class: "tab",
              role: "tab",
              type: "button",
              id: `nuni-tab-${name}`,
              "data-focus-key": `tab-${name}`,
              "aria-selected": String(tab === name),
              "aria-controls": "nuni-panel-list",
              tabindex: tab === name ? 0 : -1,
              onclick: () => setTab(name),
            },
            name === "mine"
              ? mine
                ? t("tabYours", { count: mine.length })
                : t("yours")
              : t(name === "open" ? "tabOpen" : "tabResolved", {
                  count: here(name).length + elsewhere(name).length,
                })
          )
        )
      ),
      h(
        "div",
        {
          class: "panel-list",
          id: "nuni-panel-list",
          role: "tabpanel",
          "aria-labelledby": `nuni-tab-${tab}`,
        },
        ...children
      ),
      renderFooter()
    )
  }

  const renderFooter = () => {
    const { identity } = ctx
    const status = ctx.page.status
    const claimable = status && !status.claimed && !identity.isOwner
    const commenter = identity.commenter
    if (!claimable && !commenter) return null
    return h(
      "div",
      { class: "panel-foot" },
      commenter
        ? h(
            "div",
            { class: "row" },
            avatar(commenter.name, commenter.avatarUrl),
            h(
              "span",
              { class: "meta signed-in-as" },
              t("signedInAs", { name: commenter.name })
            ),
            h("span", { class: "spacer" }),
            h(
              "button",
              {
                class: "cmp-link",
                type: "button",
                onclick: () => identity.signOutCommenter(),
              },
              t("signOut")
            )
          )
        : null,
      claimable
        ? h(
            "div",
            { class: "row" },
            h("span", { class: "meta" }, t("ownSite")),
            h("span", { class: "spacer" }),
            h(
              "button",
              {
                class: "btn",
                type: "button",
                onclick: () => identity.openDashboard("claim", "nuni-claim"),
              },
              icon(ICONS.github),
              t("claim")
            )
          )
        : null
    )
  }

  return {
    get open() {
      return open
    },

    /** Resolved pins show while the Resolved tab is open. */
    get showsResolved() {
      return open && tab === "resolved"
    },

    toggle,

    /** Give way to a card or picking on a small screen. */
    hide() {
      open = false
    },

    /** Escape: clear the search, then close. False when already closed. */
    escape(): boolean {
      if (!open) return false
      if (search) {
        search = ""
        ctx.render()
      } else toggle(false)
      return true
    },

    viewed(id: string) {
      lastViewed = id
      write(KEYS.lastViewed(ctx.config.project), id)
    },

    start() {
      ctx.api.watch(
        "pages",
        api.comments.pagesWithComments,
        {},
        (value) => {
          pages = value
          ctx.render()
        },
        []
      )
    },

    /** Keep Yours (with the current sign-in) and other pages subscribed. */
    sync() {
      if (!opened) return
      const fresh = ctx.api.watch(
        "mine",
        api.comments.listMine,
        ctx.identity.author,
        (value) => {
          mine = value
          ctx.render()
        },
        []
      )
      if (fresh) mine = null
      ctx.api.watch(
        "site",
        api.comments.listForSite,
        {},
        (value) => {
          site = value
          ctx.render()
        },
        []
      )
    },

    render,
  }
}

export const PANEL_CSS = /* css */ `
.panel {
  position: fixed;
  top: 12px;
  right: 12px;
  bottom: 72px;
  width: 340px;
  max-width: calc(100vw - 24px);
  display: flex;
  flex-direction: column;
  background: var(--n-bg);
  color: var(--n-fg);
  border: 1px solid var(--n-border);
  border-radius: var(--n-radius);
  box-shadow: var(--n-shadow);
  pointer-events: auto;
  overflow: hidden;
}
.panel-head { display: flex; align-items: center; gap: 8px; padding: 12px; border-bottom: 1px solid var(--n-border); }
.panel-title { font-weight: 650; flex: 1; }
.tabs { display: flex; gap: 4px; padding: 0 12px; margin-top: 8px; }
.tab {
  border: 0;
  background: transparent;
  padding: 6px 10px;
  border-radius: 8px;
  color: var(--n-fg-muted);
  font-weight: 550;
  font-size: 13px;
}
.tab[aria-selected="true"] { background: var(--n-bg-subtle); color: var(--n-fg); }
.panel-list { flex: 1; overflow: auto; padding: 8px; display: grid; align-content: start; gap: 4px; }
.item {
  display: grid;
  gap: 4px;
  text-align: left;
  width: 100%;
  border: 0;
  background: transparent;
  padding: 10px;
  border-radius: 10px;
}
.item:hover { background: var(--n-bg-subtle); }
/* The comment opened last, so it's easy to find your place again. */
.item[aria-current="true"] { background: var(--n-accent-soft); box-shadow: inset 3px 0 0 var(--n-accent); }
.panel-search { position: relative; padding: 0 12px; margin-top: 8px; }
.panel-search .icon { position: absolute; left: 22px; top: 50%; transform: translateY(-50%); color: var(--n-fg-muted); pointer-events: none; }
.panel-search .field { padding-left: 32px; }
.item-text { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
.section-label { padding: 12px 10px 4px; font-size: 11px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: var(--n-fg-muted); }
/* A page's path, as written: paths are case-sensitive. */
.section-path { text-transform: none; letter-spacing: 0; font-size: 12px; overflow-wrap: anywhere; }
.empty { padding: 32px 16px; text-align: center; color: var(--n-fg-muted); }
.panel-foot { padding: 12px; border-top: 1px solid var(--n-border); display: grid; gap: 8px; font-size: 13px; }
a.item { color: inherit; text-decoration: none; }

.item-quote {
  margin-top: 4px;
  padding-left: 8px;
  border-left: 2px solid var(--n-accent);
  color: var(--n-fg-muted);
  font-size: 12px;
  font-style: italic;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
`
