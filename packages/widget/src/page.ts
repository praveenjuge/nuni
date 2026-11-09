import { COMMENT_PARAM, type WidgetComment } from "@nuni/shared"

import { api, type ProjectStatus } from "./api"
import { isMobile } from "./dom"
import { onLocationChange } from "./navigation"
import type { Ctx } from "./widget"

export type Page = ReturnType<typeof createPage>

/**
 * The page the visitor is on and its comments, live, and opening one of
 * them by id (from a `?nuni=` link, the Yours list or after moving a pin).
 */
export function createPage(ctx: Ctx) {
  const { config } = ctx
  let key = ""
  let following = false
  let loaded = false
  /** The page's comments, as the live query lists them. */
  let listed: WidgetComment[] = []
  /** A comment opened by id that the listing leaves out (long resolved). */
  let extra: WidgetComment | null = null
  /** Listed and extra, oldest first. */
  let comments: WidgetComment[] = []
  /** A linked comment, opened once the page's comments have loaded. */
  let linked: string | null = null
  let status: ProjectStatus | null = null

  const merge = () => {
    const more = extra
    comments = (
      more && !listed.some((c) => c._id === more._id)
        ? [...listed, more]
        : [...listed]
    ).sort((a, b) => a.createdAt - b.createdAt)
  }

  const show = (comment: WidgetComment) => {
    ctx.pins.scrollTo(comment)
    if (isMobile()) ctx.panel.hide()
    ctx.thread.open(comment._id)
  }

  const openComment = (id: string) => {
    const comment = comments.find((c) => c._id === id)
    if (comment) return show(comment)
    ctx.api.query(api.comments.getById, { id }).then(
      (found) => {
        if (!found || found.page.path !== key) {
          ctx.toast(ctx.t("linkGone"))
          return
        }
        extra = found
        merge()
        ctx.pins.resolve(false, found._id)
        show(found)
      },
      (error: unknown) => ctx.toast(ctx.failed(error, "failed"))
    )
  }

  const openLinked = () => {
    const id = linked
    if (!id || !loaded) return
    linked = null
    openComment(id)
  }

  /** A `?nuni=<id>` link: remember the comment and tidy the address. */
  const readLink = () => {
    const url = new URL(location.href)
    const id = url.searchParams.get(COMMENT_PARAM)
    if (!id) return
    linked = id
    url.searchParams.delete(COMMENT_PARAM)
    history.replaceState(history.state, "", url.toString())
  }

  /** Subscribe to the comments of the page the visitor is on now. */
  const follow = () => {
    const next = config.getPageKey(new URL(location.href))
    if (following && next === key) return
    following = true
    key = next
    listed = []
    extra = null
    merge()
    loaded = false
    ctx.pins.reset()
    ctx.setCard(null)
    ctx.api.watch(
      "page",
      api.comments.listForPage,
      { path: next },
      (list) => {
        listed = list
        merge()
        loaded = true
        // Updates (a new comment, a reply count) keep pins that still fit.
        ctx.pins.refresh(linked ?? undefined)
        openLinked()
        ctx.render()
      },
      []
    )
  }

  return {
    get key() {
      return key
    },
    get loaded() {
      return loaded
    },
    get comments() {
      return comments
    },
    get status() {
      return status
    },

    start() {
      // Best effort: it registers this origin, and the next visit tries again.
      void ctx.api
        .mutate(api.projects.touch, {
          publicId: config.project,
          origin: location.origin,
        })
        .catch(() => null)
      ctx.api.watch("status", api.projects.status, {}, (value) => {
        status = value
        ctx.render()
      })
      readLink()
      follow()
      return onLocationChange(() => {
        readLink()
        follow()
        openLinked()
      })
    },

    openComment,

    /** A deleted comment leaves at once, without waiting for the listing. */
    drop(id: string) {
      if (extra?._id === id) extra = null
      listed = listed.filter((c) => c._id !== id)
      merge()
    },
  }
}
