import {
  buildCommentPrompt,
  LIMITS,
  REACTIONS,
  type OwnerComment,
  type ReplyView,
  type Thread,
  type WidgetComment,
} from "@nuni/shared"

import { api } from "./api"
import { autoGrow, copyText, h, icon } from "./dom"
import type { MessageKey } from "./i18n"
import { ICONS } from "./icons"
import type { PinTarget } from "./pins"
import { renderSuggestion } from "./suggestion"
import type { Ctx } from "./widget"

/** An open comment's card, and what is being typed in it. */
export interface ThreadCard {
  kind: "thread"
  id: string
  /** The comment's new words, while it is being edited. */
  edit?: { body: string; suggestion?: string }
  /** The reply being edited, with its new words. */
  replyEdit?: { id: string; body: string }
  /** The reply being written, and the name typed for it. */
  reply: string
  replyName: string
  /** The message (comment or reply id) whose emoji picker is open. */
  picker?: string | null
  error?: string
  busy?: boolean
  sendingReply?: boolean
}

const EMPTY_THREAD: Thread = { replies: [], reactions: [], images: [] }

export type ThreadCards = ReturnType<typeof createThread>

/**
 * An open comment: its card with the replies and reactions, and what the
 * author and the owner can do with it.
 */
export function createThread(ctx: Ctx) {
  const { t } = ctx
  /** Replies and reactions of the open comment. */
  let thread: Thread | null = null
  /** The open comment with its owner-only context, for a signed-in owner. */
  let detail: OwnerComment | null = null
  /** The owner query answered (possibly null), so the copy is complete. */
  let detailLoaded = false

  /** The card of comment `id`, if it is still the one open. */
  const openCard = (id: string) => {
    const card = ctx.card
    return card?.kind === "thread" && card.id === id ? card : null
  }

  /** Runs an action for the open comment. Resolves to true on success. */
  const act = async (
    id: string,
    action: () => Promise<unknown>,
    done?: MessageKey
  ): Promise<boolean> => {
    const card = openCard(id)
    if (card) {
      card.busy = true
      card.error = undefined
      ctx.render()
    }
    try {
      await action()
      if (done) ctx.toast(t(done))
      const now = openCard(id)
      if (now) {
        now.busy = false
        now.edit = undefined
      }
      ctx.render()
      return true
    } catch (error) {
      const now = openCard(id)
      if (now) {
        now.busy = false
        now.error = ctx.failed(error, "failed")
      }
      ctx.render()
      return false
    }
  }

  /** An owner action: nothing happens without an owner session. */
  const asOwner = (
    id: string,
    action: (sessionToken: string) => Promise<unknown>,
    done: MessageKey
  ) => {
    const token = ctx.identity.ownerToken
    return token ? act(id, () => action(token), done) : Promise.resolve(false)
  }

  const resolve = async (c: WidgetComment, outdated: boolean) => {
    const ok = await asOwner(
      c._id,
      (sessionToken) =>
        ctx.api.mutate(api.comments.resolve, {
          id: c._id,
          sessionToken,
          resolution: outdated ? "outdated" : undefined,
        }),
      outdated ? "closedOutdated" : "resolved"
    )
    // Resolved comments stay open where resolved ones are listed.
    if (ok && openCard(c._id) && (outdated || !ctx.panel.showsResolved)) {
      ctx.closeCard()
    }
  }

  /**
   * Delete a comment or one of its replies: the author deletes their own,
   * the owner removes anyone's.
   */
  const remove = async (comment: WidgetComment, reply?: ReplyView) => {
    const sure = await ctx.dialog.ask(
      t(reply ? "confirmDeleteReply" : "confirmDeleteComment"),
      t("delete")
    )
    if (!sure) return
    const { identity } = ctx
    const row = reply ?? comment
    const id = row._id
    const token = identity.ownerToken
    const call = identity.owns(row.authorKeyHash)
      ? () =>
          reply
            ? ctx.api.mutate(api.replies.deleteOwn, { id, ...identity.author })
            : ctx.api.mutate(api.comments.deleteOwn, { id, ...identity.author })
      : token
        ? () =>
            reply
              ? ctx.api.mutate(api.replies.remove, { id, sessionToken: token })
              : ctx.api.mutate(api.comments.remove, { id, sessionToken: token })
        : null
    if (!call) return
    // Keep the thread open on failure so the error stays visible.
    const ok = await act(comment._id, call, reply ? "replyDeleted" : "deleted")
    if (ok && !reply) {
      ctx.page.drop(id)
      ctx.closeCard()
    }
  }

  const sendReply = async (comment: WidgetComment, card: ThreadCard) => {
    const { identity } = ctx
    const asOwnerReply = identity.isOwner
    const authorName = identity.cleanName(asOwnerReply, card.replyName)
    const body = card.reply.trim()
    if (!body) return
    const invalid = !authorName
      ? t("enterName")
      : body.length > LIMITS.bodyMaxLength
        ? t("replyTooLong", { count: LIMITS.bodyMaxLength })
        : null
    if (invalid) {
      card.error = invalid
      return ctx.render()
    }
    identity.keepName(asOwnerReply, authorName)
    card.sendingReply = true
    card.error = undefined
    ctx.render()
    try {
      await ctx.api.createReply({
        commentId: comment._id,
        body,
        authorName,
        ...identity.author,
        sessionToken: identity.ownerToken ?? undefined,
      })
      card.reply = ""
    } catch (error) {
      card.error = ctx.failed(error, "replyFailed")
    }
    card.sendingReply = false
    ctx.render()
  }

  const toggleReaction = (
    comment: WidgetComment,
    targetId: string,
    emoji: string
  ) => {
    void ctx.api
      .mutate(api.reactions.toggle, {
        publicId: ctx.config.project,
        commentId: comment._id,
        targetId,
        emoji,
        ...ctx.identity.author,
      })
      .catch((error: unknown) => {
        const card = openCard(comment._id)
        if (!card) return
        card.error = ctx.failed(error, "reactFailed")
        ctx.render()
      })
  }

  const copyForAgent = (comment: WidgetComment) => {
    const owned = detail?._id === comment._id ? detail : null
    const prompt = buildCommentPrompt(
      owned ?? { ...comment, replies: thread?.replies },
      { includeContext: Boolean(owned) }
    )
    void copyText(prompt).then((ok) =>
      ctx.toast(t(ok ? "copied" : "copyFailed"))
    )
  }

  const iconButton = (
    label: string,
    svg: string,
    onclick: () => void,
    attrs: Record<string, string | boolean | null> = {}
  ) =>
    h(
      "button",
      {
        class: "icon-btn",
        type: "button",
        "aria-label": label,
        title: label,
        onclick,
        ...attrs,
      },
      icon(svg)
    )

  const buttonRow = (onCancel: () => void, onSave: () => void, busy: boolean) =>
    h(
      "div",
      { class: "row" },
      h("span", { class: "spacer" }),
      h(
        "button",
        { class: "btn btn-ghost", type: "button", onclick: onCancel },
        t("cancel")
      ),
      h(
        "button",
        {
          class: "btn btn-primary",
          type: "button",
          disabled: busy,
          onclick: onSave,
        },
        t("save")
      )
    )

  /**
   * Emoji chips for one message and the picker to add one. Replies keep
   * their add button with their other tools, so `withAdd` is off for them.
   */
  const renderReactions = (
    card: ThreadCard,
    comment: WidgetComment,
    targetId: string,
    withAdd = true
  ) => {
    const summaries = (thread?.reactions ?? []).filter(
      (r) => r.targetId === targetId
    )
    const open = card.picker === targetId
    if (!withAdd && !summaries.length && !open) return null
    return h(
      "div",
      { class: "reactions" },
      ...summaries.map((r) => {
        const mine = ctx.identity.reacted(r.authorKeyHashes)
        return h(
          "button",
          {
            class: "reaction",
            type: "button",
            "aria-pressed": String(mine),
            "aria-label": `${r.emoji} ${r.count}${mine ? ", including you" : ""}`,
            onclick: () => toggleReaction(comment, targetId, r.emoji),
          },
          `${r.emoji} ${r.count}`
        )
      }),
      withAdd ? reactionAdd(card, targetId, "reaction reaction-add") : null,
      open
        ? h(
            "div",
            {
              class: "reaction-picker",
              role: "group",
              "aria-label": t("reactions"),
            },
            ...REACTIONS.map((emoji) =>
              h(
                "button",
                {
                  class: "reaction",
                  type: "button",
                  "aria-label": t("reactWith", { emoji }),
                  onclick: () => {
                    card.picker = null
                    toggleReaction(comment, targetId, emoji)
                    ctx.render()
                  },
                },
                emoji
              )
            )
          )
        : null
    )
  }

  const reactionAdd = (card: ThreadCard, targetId: string, cls: string) => {
    const open = card.picker === targetId
    return h(
      "button",
      {
        class: cls,
        type: "button",
        "aria-label": t("addReaction"),
        "aria-expanded": String(open),
        title: t("addReaction"),
        onclick: () => {
          card.picker = open ? null : targetId
          ctx.render()
        },
      },
      icon(ICONS.smile)
    )
  }

  /** The comment being edited: its words, and its suggested words. */
  const renderEdit = (
    card: ThreadCard,
    comment: WidgetComment,
    edit: NonNullable<ThreadCard["edit"]>
  ) => {
    const textarea = h("textarea", {
      class: "field",
      maxlength: LIMITS.bodyMaxLength,
      placeholder: comment.suggestion ? t("addNote") : null,
      "data-focus-key": "edit",
      "aria-label": t("comment"),
      oninput: () => (edit.body = textarea.value),
    })
    textarea.value = edit.body
    let suggestField: HTMLTextAreaElement | null = null
    if (comment.suggestion) {
      const field = h("textarea", {
        class: "field",
        rows: 2,
        maxlength: LIMITS.quoteMaxLength,
        "data-focus-key": "edit-suggestion",
        "aria-label": t("newText"),
        oninput: () => (edit.suggestion = field.value),
      })
      field.value = edit.suggestion ?? comment.suggestion.after
      suggestField = field
    }
    return h(
      "div",
      { class: "card-body" },
      comment.suggestion && suggestField
        ? renderSuggestion(
            comment.suggestion.before,
            suggestField,
            t("suggestedEdit")
          )
        : null,
      textarea,
      buttonRow(
        () => {
          card.edit = undefined
          ctx.render()
        },
        () =>
          void act(
            comment._id,
            () =>
              ctx.api.mutate(api.comments.editOwn, {
                id: comment._id,
                ...ctx.identity.author,
                body: edit.body,
                suggestion: suggestField ? suggestField.value : undefined,
              }),
            "saved"
          ),
        Boolean(card.busy)
      )
    )
  }

  const renderComment = (card: ThreadCard, comment: WidgetComment) => {
    const { identity, pins } = ctx
    const mine = identity.owns(comment.authorKeyHash)
    const owner = identity.isOwner
    const found = pins.found(comment._id)
    const resolved = comment.status === "resolved"
    const badges = [
      resolved
        ? h(
            "span",
            { class: "badge badge-ok" },
            icon(ICONS.check),
            t(comment.resolution === "outdated" ? "outdated" : "resolved")
          )
        : null,
      comment.page.origin !== location.origin
        ? h(
            "span",
            {
              class: "badge",
              title: t("leftOn", { origin: comment.page.origin }),
            },
            new URL(comment.page.origin).host
          )
        : null,
      pins.confidence(comment._id) === "low"
        ? h(
            "span",
            { class: "badge", title: t("approximateHint") },
            t("approximate")
          )
        : null,
      !found
        ? h(
            "span",
            {
              class: "badge",
              title: t("originallyOn", {
                text: comment.anchor.text || comment.anchor.tag,
              }),
            },
            t("notFound")
          )
        : null,
    ].filter((badge) => badge !== null)
    // Owners copy the full context, so wait until it has loaded.
    const contextPending = owner && !detailLoaded
    const screenshotUrl =
      detail?._id === comment._id ? detail.screenshotUrl : null
    const movePin = () => ctx.picker.repin(comment._id)
    return h(
      "div",
      { class: "card-body msg" },
      h(
        "div",
        { class: "card-head" },
        ...identity.authorLine(comment),
        h(
          "span",
          { class: "meta" },
          ctx.i18n.timeAgo(comment.createdAt) +
            (comment.editedAt ? ` · ${t("edited")}` : "")
        ),
        h("span", { class: "spacer" }),
        owner
          ? iconButton(
              t(resolved ? "reopen" : "resolve"),
              ICONS.check,
              () =>
                resolved
                  ? void asOwner(
                      comment._id,
                      (sessionToken) =>
                        ctx.api.mutate(api.comments.reopen, {
                          id: comment._id,
                          sessionToken,
                        }),
                      "reopened"
                    )
                  : void resolve(comment, false),
              {
                class: `icon-btn${resolved ? " is-resolved" : ""}`,
                disabled: Boolean(card.busy),
              }
            )
          : null,
        iconButton(t("close"), ICONS.close, () => ctx.closeCard(), {
          class: "icon-btn card-close",
        })
      ),
      h(
        "div",
        { class: "msg-main" },
        comment.suggestion
          ? renderSuggestion(
              comment.suggestion.before,
              comment.suggestion.after,
              t("suggestedEdit"),
              owner ? [copyNewTextButton(comment.suggestion.after)] : undefined
            )
          : comment.anchor.quote
            ? h("blockquote", { class: "quote" }, comment.anchor.quote.exact)
            : null,
        comment.body ? h("div", { class: "comment-body" }, comment.body) : null,
        thread?.images.length
          ? h(
              "div",
              { class: "images" },
              ...thread.images.map((url, i) =>
                h(
                  "a",
                  {
                    href: url,
                    target: "_blank",
                    rel: "noreferrer",
                    title: t("openImage"),
                  },
                  h("img", {
                    src: url,
                    alt: t("imageN", { n: i + 1 }),
                    loading: "lazy",
                  })
                )
              )
            )
          : null,
        screenshotUrl
          ? h(
              "a",
              {
                class: "shot",
                href: screenshotUrl,
                target: "_blank",
                rel: "noreferrer",
                title: t("openScreenshot"),
              },
              h("img", { src: screenshotUrl, alt: t("screenshotTaken") })
            )
          : null,
        badges.length ? h("div", { class: "badges" }, ...badges) : null,
        owner && !resolved && !found
          ? h(
              "div",
              { class: "lost" },
              h("p", {}, t("lostHint")),
              h(
                "div",
                { class: "row" },
                h(
                  "button",
                  { class: "btn", type: "button", onclick: movePin },
                  icon(ICONS.target),
                  t("movePin")
                ),
                h(
                  "button",
                  {
                    class: "btn btn-ghost",
                    type: "button",
                    disabled: Boolean(card.busy),
                    onclick: () => void resolve(comment, true),
                  },
                  t("closeOutdated")
                )
              )
            )
          : null,
        h(
          "div",
          { class: "msg-foot" },
          renderReactions(card, comment, comment._id),
          h("span", { class: "spacer" }),
          iconButton(
            t("copyForAgent"),
            ICONS.bot,
            () => copyForAgent(comment),
            {
              title: t(contextPending ? "loadingContext" : "copyForAgentHint"),
              disabled: contextPending,
            }
          ),
          owner && found
            ? iconButton(t("movePin"), ICONS.target, movePin)
            : null,
          mine
            ? iconButton(t("edit"), ICONS.edit, () => {
                card.edit = {
                  body: comment.body,
                  suggestion: comment.suggestion?.after,
                }
                ctx.render()
              })
            : null,
          mine || owner
            ? iconButton(t("delete"), ICONS.trash, () => void remove(comment), {
                class: "icon-btn icon-btn-danger",
                "data-focus-key": "delete",
                disabled: Boolean(card.busy),
              })
            : null
        ),
        card.error
          ? h("div", { class: "error", role: "alert" }, card.error)
          : null
      )
    )
  }

  /** For the owner: the suggested words, ready to paste into the code. */
  const copyNewTextButton = (text: string) =>
    h(
      "button",
      {
        class: "cmp-link",
        type: "button",
        onclick: () =>
          void copyText(text).then((ok) =>
            ctx.toast(t(ok ? "newTextCopied" : "copyFailed"))
          ),
      },
      t("copyNewText")
    )

  const renderReply = (
    card: ThreadCard,
    comment: WidgetComment,
    reply: ReplyView
  ) => {
    const { identity } = ctx
    const mine = identity.owns(reply.authorKeyHash)
    const edit = card.replyEdit?.id === reply._id ? card.replyEdit : null
    if (edit) {
      const box = h("textarea", {
        class: "field",
        maxlength: LIMITS.bodyMaxLength,
        "data-focus-key": `reply-edit-${reply._id}`,
        "aria-label": t("editReply"),
        oninput: () => (edit.body = box.value),
      })
      box.value = edit.body
      return h(
        "div",
        { class: "reply" },
        box,
        buttonRow(
          () => {
            card.replyEdit = undefined
            ctx.render()
          },
          () =>
            void act(
              comment._id,
              () =>
                ctx.api.mutate(api.replies.editOwn, {
                  id: reply._id,
                  ...identity.author,
                  body: edit.body,
                }),
              "saved"
            ).then((ok) => {
              if (ok && openCard(comment._id)) {
                card.replyEdit = undefined
                ctx.render()
              }
            }),
          Boolean(card.busy)
        )
      )
    }
    return h(
      "div",
      { class: "reply msg", "data-reply": reply._id },
      h(
        "div",
        { class: "card-head" },
        ...identity.authorLine(reply),
        reply.isOwner
          ? h("span", { class: "badge badge-owner" }, t("owner"))
          : null,
        h(
          "span",
          { class: "meta" },
          ctx.i18n.timeAgo(reply.createdAt) +
            (reply.editedAt ? ` · ${t("edited")}` : "")
        ),
        h("span", { class: "spacer" }),
        h(
          "span",
          { class: "msg-tools" },
          reactionAdd(card, reply._id, "icon-btn"),
          mine
            ? iconButton(
                t("editReply"),
                ICONS.edit,
                () => {
                  card.replyEdit = { id: reply._id, body: reply.body }
                  ctx.render()
                },
                { title: t("edit") }
              )
            : null,
          mine || identity.isOwner
            ? iconButton(
                t("deleteReply"),
                ICONS.trash,
                () => void remove(comment, reply),
                {
                  class: "icon-btn icon-btn-danger",
                  title: t("delete"),
                  "data-focus-key": `delete-${reply._id}`,
                  disabled: Boolean(card.busy),
                }
              )
            : null
        )
      ),
      h(
        "div",
        { class: "msg-main" },
        h("div", { class: "comment-body" }, reply.body),
        renderReactions(card, comment, reply._id, false)
      )
    )
  }

  /** The replies under a comment and the box to add one. */
  const renderReplies = (card: ThreadCard, comment: WidgetComment) => {
    const replies = thread?.replies ?? []
    const items = replies.map((reply) => renderReply(card, comment, reply))
    const needsName = !ctx.identity.nameFor(ctx.identity.isOwner)
    const nameInput = h("input", {
      class: "reply-name",
      placeholder: t("yourName"),
      value: card.replyName,
      maxlength: LIMITS.nameMaxLength,
      autocomplete: "name",
      "data-focus-key": "reply-name",
      "aria-label": t("yourName"),
      oninput: () => (card.replyName = nameInput.value),
    })
    const sendButton = h(
      "button",
      {
        class: "reply-send",
        type: "submit",
        "aria-label": t("sendReply"),
        title: t("sendReply"),
        disabled: Boolean(card.sendingReply) || !card.reply.trim(),
      },
      icon(ICONS.arrowUp)
    )
    const grow = () => {
      sendButton.disabled = Boolean(card.sendingReply) || !card.reply.trim()
      autoGrow(box)
    }
    const box = h("textarea", {
      class: "reply-text",
      placeholder: t(replies.length ? "reply" : "replyFirst"),
      maxlength: LIMITS.bodyMaxLength,
      rows: 1,
      "data-focus-key": "reply",
      "aria-label": t("reply"),
      oninput: () => {
        card.reply = box.value
        grow()
      },
      onkeydown: (e: Event) => {
        const key = e as KeyboardEvent
        if (key.key === "Enter" && (key.metaKey || key.ctrlKey)) {
          e.preventDefault()
          void sendReply(comment, card)
        }
      },
    })
    box.value = card.reply
    ctx.afterRender(grow)
    return h(
      "div",
      { class: "thread" },
      items.length
        ? h(
            "div",
            {
              class: "replies",
              role: "list",
              "aria-label": t("replyCount", { count: items.length }),
            },
            ...items.map((item) => {
              item.setAttribute("role", "listitem")
              return item
            })
          )
        : null,
      h(
        "form",
        {
          class: "reply-form",
          onsubmit: (e: Event) => {
            e.preventDefault()
            void sendReply(comment, card)
          },
        },
        needsName ? nameInput : null,
        h("div", { class: "reply-row" }, box, sendButton)
      )
    )
  }

  return {
    /** Open a comment's card and move focus into it. */
    open(id: string) {
      ctx.dialog.keepFocus()
      ctx.panel.viewed(id)
      ctx.dialog.focusAfterRender('[data-card="thread"] .card-close')
      ctx.setCard({ kind: "thread", id, reply: "", replyName: "" })
    },

    /** Keep the open comment's replies, and its owner context, subscribed. */
    sync() {
      const card = ctx.card
      const id = card?.kind === "thread" ? card.id : null
      const fresh = ctx.api.watch(
        "thread",
        api.replies.listForComment,
        id ? { commentId: id } : null,
        (value) => {
          thread = value
          ctx.render()
        },
        EMPTY_THREAD
      )
      if (fresh || !id) thread = null
      const token = ctx.identity.ownerToken
      const args = id && token ? { id, sessionToken: token } : null
      const freshDetail = ctx.api.watch(
        "ownerDetail",
        api.comments.getForOwner,
        args,
        (value) => {
          detail = value
          detailLoaded = true
          ctx.render()
        },
        null
      )
      if (freshDetail || !args) {
        detail = null
        detailLoaded = false
      }
    },

    render(card: ThreadCard, cls: string): HTMLElement | null {
      const comment = ctx.page.comments.find((c) => c._id === card.id)
      if (!comment) return null
      return h(
        "div",
        {
          class: cls,
          "data-card": "thread",
          role: "dialog",
          "aria-label": t("commentBy", { name: comment.authorName }),
        },
        card.edit
          ? renderEdit(card, comment, card.edit)
          : renderComment(card, comment),
        card.edit ? null : renderReplies(card, comment)
      )
    },

    /** Words that haven't been sent: a press outside keeps the card. */
    unsent(card: ThreadCard): boolean {
      return Boolean(
        card.reply.trim() ||
        card.edit?.body.trim() ||
        card.edit?.suggestion?.trim() ||
        card.replyEdit?.body.trim()
      )
    },

    /** Point a comment at another element on its page (owners only). */
    async movePin(id: string, target: PinTarget) {
      const token = ctx.identity.ownerToken
      if (!token) return
      const undo = ctx.pins.place(id, target)
      try {
        await ctx.api.mutate(api.comments.repin, {
          id,
          anchor: target.anchor,
          sessionToken: token,
        })
        ctx.toast(t("pinMoved"))
      } catch (error) {
        undo()
        ctx.toast(ctx.failed(error, "failed"))
      }
      ctx.page.openComment(id)
    },
  }
}
