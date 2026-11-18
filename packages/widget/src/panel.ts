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
  /** Only this author's comments, by the name shown; empty for everyone. */
  let person = ""
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
    } else clearFilters()
    ctx.render()
    if (!on && !ctx.card) ctx.dialog.restoreFocus()
  }

  const setTab = (next: Tab) => {
    tab = next
    ctx.render()
  }

  function clearFilters() {
    search = ""
    person = ""
  }

  const render = () => {
    const { page } = ctx
    const query = search.trim().toLocaleLowerCase()
    // Yours are all the visitor's own, so only the search applies there.
    const byPerson = tab === "mine" ? "" : person
    const filtering = Boolean(query || byPerson)
    const hit = (...texts: (string | undefined)[]) =>
      !query || texts.some((text) => text?.toLocaleLowerCase().includes(query))
    const matches = (c: WidgetComment) =>
      hit(
        c.body,
        c.authorName,
        c.anchor.quote?.exact,
        c.suggestion?.after,
        c.page.path
      )
    const found = (c: WidgetComment) =>
      matches(c) && (!person || c.authorName === person)
    const status = tab === "resolved" ? "resolved" : "open"
    const here = (s: WidgetComment["status"]) =>
      page.comments.filter((c) => c.status === s)
    const elsewhere = (s: WidgetComment["status"]) =>
      (site ?? []).filter((c) => c.page.path !== page.key && c.status === s)
    const list =
      tab === "mine" ? (mine ?? []).filter(matches) : here(status).filter(found)
    const placed = list.filter((c) => ctx.pins.found(c._id))
    const lost = list.filter((c) => !ctx.pins.found(c._id))
    const groups = new Map<string, WidgetComment[]>()
    for (const c of elsewhere(status).filter(found)) {
      groups.set(c.page.path, [...(groups.get(c.page.path) ?? []), c])
    }
    // Pages past the newest comments listed (or before they load): a link.
    // Who wrote their comments isn't known here, so they hide for a person.
    const listed = new Set(elsewhere(status).map((c) => c.page.path))
    const otherPages = pages.filter(
      (p) =>
        p.path !== page.key && !listed.has(p.path) && !person && hit(p.path)
    )
    /** How many each tab lists with the current filters. */
    const count = (name: Tab) =>
      name === "mine"
        ? (mine ?? []).filter(matches).length
        : here(name).filter(found).length + elsewhere(name).filter(found).length
    /** Everyone with a comment here or on another page, to filter by. */
    const people = [
      ...new Set([...page.comments, ...(site ?? [])].map((c) => c.authorName)),
    ].sort((a, b) => a.localeCompare(b))
    if (person && !people.includes(person)) people.unshift(person)

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
    const noMatches = () =>
      h(
        "div",
        { class: "empty" },
        h(
          "p",
          {},
          byPerson
            ? t("noMatchesFilters")
            : t("noMatches", { query: search.trim() })
        ),
        h(
          "button",
          {
            class: "btn",
            type: "button",
            "data-focus-key": "clear-filters",
            onclick: () => {
              clearFilters()
              ctx.dialog.focusAfterRender('[data-focus-key="panel-search"]')
              ctx.render()
            },
          },
          t("clearFilters")
        )
      )

    const children: Node[] = []
    if (tab === "mine") {
      if (!mine) children.push(empty(t("loading")))
      else if (!list.length) {
        children.push(filtering ? noMatches() : empty(t("noYours")))
      } else children.push(...list.map(mineItem))
    } else if (!page.loaded) {
      children.push(empty(t("loading")))
    } else {
      // This page first, then every other page with its comments.
      const others = groups.size > 0 || otherPages.length > 0
      if (others && (list.length || !filtering)) {
        children.push(label(t("thisPage")))
      }
      if (list.length) {
        children.push(...placed.map((c) => item(c)))
        if (lost.length) {
          children.push(label(t("notFoundHere")), ...lost.map((c) => item(c)))
        }
      } else if (!filtering) {
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

    const searchBox = h(
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
      }),
      search
        ? h(
            "button",
            {
              class: "icon-btn",
              type: "button",
              "aria-label": t("clearSearch"),
              onclick: () => {
                search = ""
                ctx.dialog.focusAfterRender('[data-focus-key="panel-search"]')
                ctx.render()
              },
            },
            icon(ICONS.close)
          )
        : null
    )

    // Shown once there is more than one person to choose from.
    const personPicker =
      tab !== "mine" && people.length > 1
        ? h(
            "div",
            { class: person ? "panel-person is-on" : "panel-person" },
            icon(ICONS.user),
            h(
              "select",
              {
                "aria-label": t("filterByPerson"),
                "aria-controls": "nuni-panel-list",
                "data-focus-key": "panel-person",
                onchange: (e: Event) => {
                  person = (e.target as HTMLSelectElement).value
                  ctx.render()
                },
              },
              h("option", { value: "", selected: !person }, t("everyone")),
              people.map((name) =>
                h("option", { value: name, selected: name === person }, name)
              )
            ),
            icon(ICONS.chevronDown)
          )
        : null

    return h(
      "div",
      { class: "panel", role: "dialog", "aria-label": t("comments") },
      h(
        "div",
        { class: "panel-top" },
        h(
          "div",
          { class: "panel-head" },
          // First, so Tab goes from the tabs on to the filters and the list.
          h(
            "button",
            {
              class: "icon-btn",
              type: "button",
              "aria-label": t("close"),
              onclick: () => toggle(false),
            },
            icon(ICONS.close)
          ),
          renderTabs()
        ),
        page.comments.length || mine?.length || site?.length
          ? h("div", { class: "panel-filters" }, searchBox, personPicker)
          : null
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

    function renderTabs() {
      return h(
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
        TABS.map((name) => {
          const n = name === "mine" && !mine ? null : count(name)
          return h(
            "button",
            {
              class: "tab",
              role: "tab",
              type: "button",
              id: `nuni-tab-${name}`,
              "data-focus-key": `tab-${name}`,
              "aria-selected": String(tab === name),
              "aria-controls": "nuni-panel-list",
              // The visible name and count, in a translatable sentence.
              "aria-label":
                n === null
                  ? t("yours")
                  : t(
                      name === "open"
                        ? "tabOpen"
                        : name === "resolved"
                          ? "tabResolved"
                          : "tabYours",
                      { count: n }
                    ),
              tabindex: tab === name ? 0 : -1,
              onclick: () => setTab(name),
            },
            t(
              name === "open"
                ? "statusOpen"
                : name === "resolved"
                  ? "resolved"
                  : "yours"
            ),
            n ? h("span", { class: "tab-count" }, String(n)) : null
          )
        })
      )
    }
  }

  const renderFooter = () => {
    const { identity } = ctx
    const status = ctx.page.status
    const claimable = status && !status.claimed && !identity.ownerToken
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

    /**
     * Escape: clear the search, then the person, then close. False when
     * already closed.
     */
    escape(): boolean {
      if (!open) return false
      if (search) search = ""
      // Yours has no person filter to clear.
      else if (person && tab !== "mine") person = ""
      else {
        toggle(false)
        return true
      }
      ctx.render()
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
.panel-top { display: grid; gap: 8px; padding: 10px; border-bottom: 1px solid var(--n-border); }
.panel-head { display: flex; align-items: center; gap: 8px; }
.panel-head .icon-btn { order: 1; margin-left: auto; }
/* The tabs, as one segmented control. */
.tabs { display: flex; gap: 2px; padding: 2px; border-radius: 10px; background: var(--n-bg-subtle); min-width: 0; }
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  border: 0;
  background: transparent;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--n-fg-muted);
  font-weight: 550;
  font-size: 13px;
  white-space: nowrap;
}
.tab:hover { color: var(--n-fg); }
.tab[aria-selected="true"] { background: var(--n-bg); color: var(--n-fg); box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 0 0 1px var(--n-border); }
.tab-count { font-size: 11px; font-weight: 600; color: var(--n-fg-muted); font-variant-numeric: tabular-nums; }
.panel-filters { display: flex; gap: 6px; }
.panel-search { position: relative; flex: 1; min-width: 0; }
.panel-search > .icon { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); width: 15px; height: 15px; color: var(--n-fg-muted); pointer-events: none; }
.panel-search .field { height: 32px; padding: 0 30px 0 30px; border-color: transparent; background: var(--n-bg-subtle); font-size: 13px; }
.panel-search .field:focus { background: var(--n-bg); }
.panel-search .field::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
.panel-search .icon-btn { position: absolute; right: 4px; top: 4px; width: 24px; height: 24px; border-radius: 6px; }
.panel-search .icon-btn .icon { width: 14px; height: 14px; }
/* Who to show: a compact native select, tinted while it filters. */
.panel-person { position: relative; display: flex; align-items: center; flex: none; max-width: 45%; border-radius: 8px; background: var(--n-bg-subtle); color: var(--n-fg-muted); }
.panel-person:hover, .panel-person:focus-within { color: var(--n-fg); }
.panel-person.is-on { background: var(--n-accent-soft); color: var(--n-accent); }
.panel-person > .icon { position: absolute; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; pointer-events: none; }
.panel-person > .icon:first-child { left: 9px; }
.panel-person > .icon:last-child { right: 7px; width: 13px; height: 13px; }
.panel-person select {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: 32px;
  padding: 0 26px 0 29px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.panel-person select:focus-visible { outline: 2px solid var(--n-accent); outline-offset: 0; }
/* The native list takes the page's colors, so it follows the widget's. */
.panel-person option { background: var(--n-bg); color: var(--n-fg); }
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
.item-text { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
.section-label { padding: 12px 10px 4px; font-size: 11px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: var(--n-fg-muted); }
/* A page's path, as written: paths are case-sensitive. */
.section-path { text-transform: none; letter-spacing: 0; font-size: 12px; overflow-wrap: anywhere; }
.empty { padding: 32px 16px; text-align: center; color: var(--n-fg-muted); display: grid; justify-items: center; gap: 12px; }
.empty p { margin: 0; }
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
