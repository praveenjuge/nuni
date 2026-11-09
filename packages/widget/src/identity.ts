import {
  DASHBOARD_ROUTES,
  dashboardUrl,
  generateSecret,
  LIMITS,
  readHandoff,
  type WidgetAuthor,
} from "@nuni/shared"

import { api } from "./api"
import { colorFor, h, icon, initials } from "./dom"
import { ICONS } from "./icons"
import { sha256Hex } from "./sha256"
import { KEYS, read, write } from "./storage"
import type { Ctx } from "./widget"

/** A visitor signed in to comment under their account. */
interface Commenter {
  name: string
  avatarUrl?: string
  /** The author key on their comments. */
  authorKey: string
}

export type Identity = ReturnType<typeof createIdentity>

/**
 * Who is writing: this browser (its secret and the name typed here), a
 * commenter account it signed in to, and the owner's session. Owns the
 * rules for which name a message goes out under and what this visitor may
 * change.
 */
export function createIdentity(ctx: Ctx) {
  const { config } = ctx
  let secret = read(KEYS.secret)
  if (!secret) {
    secret = generateSecret()
    write(KEYS.secret, secret)
  }
  /** The author key of this browser's guest comments, once hashed. */
  let secretHash = ""
  /** The name typed in this browser, for messages not under an account. */
  let typedName = read(KEYS.name) ?? ""
  let ownerToken = read(KEYS.session(config.project))
  let ownerName: string | null = null
  let commenterToken = read(KEYS.commenter(config.project))
  let commenter: Commenter | null = null

  const watchSession = (token: string) =>
    ctx.api.watch(
      "session",
      api.sessions.validate,
      { sessionToken: token },
      (result) => {
        if (result.valid) {
          ownerName = result.ownerName ?? ctx.t("owner")
        } else {
          ownerName = ownerToken = null
          write(KEYS.session(config.project), null)
          ctx.api.watch("session", null)
        }
        ctx.render()
      }
    )

  const watchCommenter = (token: string) =>
    ctx.api.watch(
      "commenter",
      api.commenters.validate,
      { commenterToken: token },
      (result) => {
        if (result.valid) {
          const { name, avatarUrl, authorKey } = result
          commenter = { name, avatarUrl, authorKey }
        } else {
          forgetCommenter()
        }
        ctx.render()
      }
    )

  /** Back to commenting as a guest in this browser. */
  const forgetCommenter = () => {
    ctx.api.watch("commenter", null)
    commenterToken = null
    commenter = null
    write(KEYS.commenter(config.project), null)
  }

  const onCommenterSignedIn = async (token: string) => {
    commenterToken = token
    write(KEYS.commenter(config.project), token)
    // Best effort: guest comments from this browser join the account.
    await ctx.api
      .mutate(api.commenters.linkBrowser, {
        publicId: config.project,
        authorSecret: secret,
        commenterToken: token,
      })
      .catch(() => null)
    if (commenterToken !== token) return
    watchCommenter(token)
    ctx.toast(ctx.t("commenterSignedIn"))
  }

  /** The account a message goes out under, if any: see `nameFor`. */
  const accountName = (asOwner: boolean) =>
    (asOwner && ownerName) || commenter?.name || null

  const self = {
    start() {
      void sha256Hex(secret).then((hash) => {
        secretHash = hash
        ctx.render()
      })
      if (ownerToken) watchSession(ownerToken)
      if (commenterToken) watchCommenter(commenterToken)
    },

    /** Who is writing, for every comment, reply, reaction and upload. */
    get author(): WidgetAuthor {
      return {
        authorSecret: secret,
        commenterToken: commenterToken ?? undefined,
      }
    },

    get commenter() {
      return commenter
    },

    get ownerToken() {
      return ownerName ? ownerToken : null
    },

    get isOwner() {
      return Boolean(ownerToken && ownerName)
    },

    /**
     * The name a message goes out under: the owner's (`asOwner`, a reply
     * while signed in as the owner), the commenter account's, or the one
     * typed in this browser. Empty while the visitor still has to type it.
     */
    nameFor(asOwner: boolean): string {
      return accountName(asOwner) ?? typedName
    },

    /**
     * The cleaned name for a message, from the account or what was typed.
     * A typed name is remembered for next time with `keepName`.
     */
    cleanName(asOwner: boolean, typed: string): string {
      return (accountName(asOwner) ?? (typedName || typed))
        .trim()
        .slice(0, LIMITS.nameMaxLength)
    },

    keepName(asOwner: boolean, name: string) {
      if (accountName(asOwner)) return
      typedName = name
      write(KEYS.name, name)
    },

    /** "Not you?": type a name again (the stored one stays until then). */
    forgetName() {
      typedName = ""
    },

    /**
     * Whether this visitor wrote it and may change it: signed in or not,
     * this browser's guest comments stay theirs.
     */
    owns(key: string): boolean {
      return (
        Boolean(key) && (key === secretHash || key === commenter?.authorKey)
      )
    },

    /**
     * Whether pressing a reaction removes this visitor's own: reactions
     * toggle under the current author only (the account when signed in),
     * not under this browser's guest key.
     */
    reacted(authorKeys: string[]): boolean {
      return authorKeys.includes(commenter?.authorKey ?? secretHash)
    },

    /**
     * Claim the site, or sign in to comment under an account, in a
     * dashboard popup that posts the token back (see `onMessage`).
     */
    openDashboard(route: "claim" | "commentSignIn", windowName: string) {
      const url = dashboardUrl(config.appUrl, DASHBOARD_ROUTES[route], {
        project: config.project,
        origin: location.origin,
      })
      const popup = window.open(url, windowName, "popup,width=480,height=680")
      if (!popup) location.href = url
    },

    onMessage(e: MessageEvent) {
      let appOrigin: string
      try {
        appOrigin = new URL(config.appUrl).origin
      } catch {
        return
      }
      if (e.origin !== appOrigin) return
      const handoff = readHandoff(e.data, config.project)
      if (handoff?.kind === "commenter") {
        void onCommenterSignedIn(handoff.token)
      } else if (handoff?.kind === "session") {
        ownerToken = handoff.token
        write(KEYS.session(config.project), handoff.token)
        watchSession(handoff.token)
        ctx.toast(ctx.t("signedIn"))
      }
    },

    signOutCommenter() {
      const token = commenterToken
      if (!token) return
      forgetCommenter()
      // Best effort: this browser has forgotten the sign-in already.
      void ctx.api
        .mutate(api.commenters.signOut, { commenterToken: token })
        .catch(() => null)
      ctx.toast(ctx.t("signedOut"))
    },

    /** An author's photo and name, marked when they wrote it signed in. */
    authorLine(row: {
      authorName: string
      signedIn?: boolean
      avatarUrl?: string
    }) {
      return [
        avatar(row.authorName, row.signedIn ? row.avatarUrl : undefined),
        h("span", { class: "author" }, row.authorName),
        row.signedIn
          ? h(
              "span",
              {
                class: "signed-in",
                role: "img",
                "aria-label": ctx.t("signedInGithub"),
                title: ctx.t("signedInGithub"),
              },
              icon(ICONS.github)
            )
          : null,
      ]
    },
  }
  return self
}

/** Initials, under the account photo of an author who signed in. */
export function avatar(name: string, photo?: string): HTMLSpanElement {
  const el = h(
    "span",
    { class: "avatar", style: `background:${colorFor(name)}` },
    initials(name)
  )
  if (photo?.startsWith("https://")) {
    const img = h("img", {
      src: photo,
      alt: "",
      loading: "lazy",
      referrerpolicy: "no-referrer",
      // The initials show if the photo can't load.
      onerror: () => img.remove(),
    })
    el.append(img)
  }
  return el
}
