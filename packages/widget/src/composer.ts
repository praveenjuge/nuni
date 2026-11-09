import {
  describeLocation,
  IMAGE_TYPES,
  isImageType,
  LIMITS,
  type CommentContext,
  type DomContext,
} from "@nuni/shared"

import { domContext } from "./context"
import { autoGrow, colorFor, h, icon, initials } from "./dom"
import { ICONS } from "./icons"
import { imageFromFile } from "./image"
import { regionBox, type PinTarget } from "./pins"
import { ACCENT } from "./styles"
import { renderSuggestion, suggestableText } from "./suggestion"
import type { Ctx } from "./widget"

/** A comment being written, and everything it will be posted with. */
export interface Draft extends PinTarget {
  dom?: DomContext
  /** Taken while the person types and uploaded once the comment is posted. */
  screenshot?: Promise<Blob | null>
  /** The commented text, when new words can be suggested for it. */
  suggestFrom: string | null
  suggesting?: boolean
  /** The suggested words, as typed. */
  suggestion?: string
  body: string
  /** The name typed in the box, when there is no name yet. */
  name: string
  /** Images to attach once posted: picked, pasted or a marked-up screenshot. */
  images: { blob: Blob; url: string }[]
  /** Waiting for the screenshot before the editor opens. */
  preparingMarkup?: boolean
  error?: string
  sending?: boolean
}

export type Composer = ReturnType<typeof createComposer>

/** Writing a new comment: the box, its images and posting it. */
export function createComposer(ctx: Ctx) {
  const { config, runtime, t } = ctx

  /** An iframe's document can't be rendered from the page. */
  const canScreenshot = (draft: Draft) =>
    Boolean(runtime.loadScreenshot) && draft.element.ownerDocument === document

  /** Whether this comment box can take images (claimed sites only). */
  const canAttach = (draft: Draft) =>
    config.images &&
    Boolean(ctx.page.status?.claimed) &&
    draft.images.length < LIMITS.imagesPerComment

  /** Capture while the person types, so posting stays instant. */
  const takeScreenshot = async (draft: Draft): Promise<Blob | null> => {
    const load = runtime.loadScreenshot
    if (!load || !canScreenshot(draft)) return null
    const accent =
      getComputedStyle(ctx.host).getPropertyValue("--n-accent").trim() || ACCENT
    try {
      // The capture clones part of the page: let the composer paint first.
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
      const tools = await load()
      const { range, anchor, element } = draft
      // Selected text or an area: the image centers on that part.
      const focus = range
        ? () => range.getBoundingClientRect()
        : anchor.region
          ? () => {
              const box = regionBox(anchor, element)!
              return {
                left: box.left,
                top: box.top,
                right: box.left + box.width,
                bottom: box.top + box.height,
              }
            }
          : undefined
      return tools
        ? await tools.capture(element, { exclude: ctx.host, accent, focus })
        : null
    } catch {
      // No screenshot then; the comment still works.
      return null
    }
  }

  const collectContext = (draft: Draft): CommentContext | undefined => {
    const context: CommentContext = {}
    const logs = runtime.collectors.console()
    const failed = runtime.collectors.network()
    if (logs.length) context.console = logs
    if (failed.length) context.network = failed
    if (draft.dom) context.dom = draft.dom
    return Object.keys(context).length ? context : undefined
  }

  const setError = (draft: Draft, message: string) => {
    draft.error = message
    ctx.render()
  }

  /** After posting; the comment is there even if this fails. */
  const attachScreenshot = async (id: string, shot: Promise<Blob | null>) => {
    try {
      // A capture still running when Post was clicked is sent when it lands.
      const image = await shot
      if (image) {
        await ctx.api.upload("screenshot", id, ctx.identity.author, image)
      }
    } catch {
      // The screenshot is for the owner, and optional.
    }
  }

  /** One after another, so they keep their order. */
  const attachImages = async (id: string, images: Draft["images"]) => {
    try {
      for (const image of images) {
        await ctx.api.upload("image", id, ctx.identity.author, image.blob)
      }
    } catch (error) {
      ctx.toast(ctx.failed(error, "imageFailed"))
    }
  }

  const addImages = async (draft: Draft, files: Iterable<File>) => {
    draft.error = undefined
    for (const file of files) {
      if (draft.images.length >= LIMITS.imagesPerComment) {
        draft.error = t("tooManyImages", { count: LIMITS.imagesPerComment })
        break
      }
      const blob = await imageFromFile(file)
      if (!blob) {
        draft.error = t("imageUnreadable")
        continue
      }
      draft.images.push({ blob, url: URL.createObjectURL(blob) })
    }
    ctx.render()
  }

  /** Draw on the screenshot, then attach the result for everyone to see. */
  const markUpScreenshot = async (draft: Draft) => {
    const load = runtime.loadScreenshot
    if (!load || !draft.screenshot || draft.preparingMarkup) return
    draft.preparingMarkup = true
    draft.error = undefined
    ctx.render()
    const [tools, shot] = await Promise.all([load(), draft.screenshot])
    draft.preparingMarkup = false
    if (!tools || !shot) return setError(draft, t("noScreenshot"))
    const marked = await tools.markUp(shot, {
      container: ctx.modalLayer,
      labels: {
        title: t("markUpTitle"),
        box: t("markUpBox"),
        arrow: t("markUpArrow"),
        pen: t("markUpPen"),
        undo: t("markUpUndo"),
        cancel: t("cancel"),
        done: t("markUpDone"),
        failed: t("markUpFailed"),
      },
    })
    if (marked)
      draft.images.push({ blob: marked, url: URL.createObjectURL(marked) })
    ctx.render()
  }

  const submit = async (draft: Draft) => {
    const name = ctx.identity.cleanName(false, draft.name)
    const body = draft.body.trim()
    if (!name) return setError(draft, t("enterName"))
    const before = draft.suggesting ? draft.suggestFrom : null
    const after = (draft.suggestion ?? before ?? "").trim()
    if (before !== null && (!after || after === before)) {
      return setError(draft, t("changeTextFirst"))
    }
    if (after.length > LIMITS.quoteMaxLength) {
      return setError(
        draft,
        t("suggestionTooLong", { count: LIMITS.quoteMaxLength })
      )
    }
    const suggestion = before !== null ? { before, after } : undefined
    if (!body && !suggestion) return setError(draft, t("writeFirst"))
    if (body.length > LIMITS.bodyMaxLength) {
      return setError(
        draft,
        t("commentTooLong", { count: LIMITS.bodyMaxLength })
      )
    }
    ctx.identity.keepName(false, name)
    draft.sending = true
    draft.error = undefined
    ctx.render()

    try {
      const id = await ctx.api.createComment({
        body,
        suggestion,
        authorName: name,
        ...ctx.identity.author,
        page: {
          ...describeLocation(location.href),
          path: ctx.page.key,
          title: document.title.slice(0, 300),
        },
        anchor: draft.anchor,
        viewport: {
          w: window.innerWidth,
          h: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
        },
        context: collectContext(draft),
      })
      if (draft.screenshot) void attachScreenshot(id, draft.screenshot)
      if (draft.images.length) void attachImages(id, [...draft.images])
      ctx.pins.place(id, draft)
      const card = ctx.card
      if (card?.kind === "composer" && card.draft === draft) ctx.setCard(null)
      ctx.toast(t("added"))
    } catch (error) {
      draft.sending = false
      setError(
        draft,
        ctx.failed(error, "postFailed", { cap_reached: "siteFull" })
      )
    }
  }

  const render = (draft: Draft, cls: string): HTMLElement => {
    const { identity } = ctx
    const commenter = identity.commenter
    const name = identity.nameFor(false)
    const needsName = !name
    const avatar = h("span", {
      class: "avatar cmp-avatar",
      "aria-hidden": "true",
    })
    const paintAvatar = (value: string) => {
      const clean = value.trim()
      avatar.classList.toggle("avatar-empty", !clean)
      if (clean) {
        avatar.textContent = initials(clean)
        avatar.style.background = colorFor(clean)
      } else {
        avatar.replaceChildren(icon(ICONS.user))
        avatar.style.background = ""
      }
    }
    paintAvatar(needsName ? draft.name : name)
    const nameInput = h("input", {
      class: "cmp-name",
      placeholder: t("yourName"),
      value: draft.name,
      maxlength: LIMITS.nameMaxLength,
      autocomplete: "name",
      "data-focus-key": "name",
      "aria-label": t("yourName"),
      oninput: () => {
        draft.name = nameInput.value
        paintAvatar(draft.name)
      },
    })
    const before = draft.suggestFrom
    const suggesting = Boolean(draft.suggesting) && before !== null
    // A changed text is enough to post; a note is optional then.
    const canPost = () => {
      const after = suggesting ? (draft.suggestion ?? before).trim() : ""
      return Boolean(draft.body.trim()) || Boolean(after && after !== before)
    }
    const counter = h("span", { class: "cmp-count", "aria-live": "polite" })
    const post = h(
      "button",
      {
        class: "cmp-post",
        type: "submit",
        disabled: Boolean(draft.sending) || !canPost(),
      },
      draft.sending ? t("posting") : t("post"),
      icon(ICONS.arrowUp)
    )
    const fields: HTMLTextAreaElement[] = []
    // Only shown close to the limit, so it never adds noise.
    const update = () => {
      post.disabled = Boolean(draft.sending) || !canPost()
      const left = LIMITS.bodyMaxLength - draft.body.length
      counter.textContent =
        left <= LIMITS.bodyMaxLength * 0.1
          ? t("charsLeft", { count: left })
          : ""
      for (const field of fields) autoGrow(field, 2)
    }
    const onKey = (e: Event) => {
      const key = e as KeyboardEvent
      if (key.key === "Enter" && (key.metaKey || key.ctrlKey)) {
        e.preventDefault()
        void submit(draft)
      }
    }
    const textarea = h("textarea", {
      class: "cmp-text",
      placeholder: t(suggesting ? "addNote" : "leaveComment"),
      maxlength: LIMITS.bodyMaxLength,
      rows: 3,
      "data-focus-key": "body",
      "aria-label": t("comment"),
      onkeydown: onKey,
      oninput: () => {
        draft.body = textarea.value
        update()
        ctx.positionCard()
      },
    })
    textarea.value = draft.body
    fields.push(textarea)
    let suggestInput: HTMLTextAreaElement | null = null
    if (suggesting) {
      const input = h("textarea", {
        class: "cmp-suggest",
        maxlength: LIMITS.quoteMaxLength,
        rows: 1,
        "data-focus-key": "suggestion",
        "aria-label": t("newText"),
        onkeydown: onKey,
        oninput: () => {
          draft.suggestion = input.value
          update()
          ctx.positionCard()
        },
      })
      input.value = draft.suggestion ?? before
      fields.push(input)
      suggestInput = input
    }
    ctx.afterRender(update)

    const attach = canAttach(draft)
    const fileInput = attach
      ? h("input", {
          type: "file",
          accept: IMAGE_TYPES.join(","),
          multiple: true,
          hidden: true,
          tabindex: -1,
          "aria-hidden": "true",
          onchange: (e: Event) => {
            const input = e.target as HTMLInputElement
            const files = [...(input.files ?? [])]
            input.value = ""
            void addImages(draft, files)
          },
        })
      : null
    if (attach) {
      textarea.addEventListener("paste", (e) => {
        const files = [...(e.clipboardData?.files ?? [])].filter((f) =>
          isImageType(f.type)
        )
        if (!files.length) return
        e.preventDefault()
        void addImages(draft, files)
      })
    }
    const setSuggesting = (on: boolean) => {
      draft.suggesting = on
      draft.error = undefined
      ctx.render()
      const field = ctx.ui.querySelector<HTMLTextAreaElement>(
        `[data-focus-key="${on ? "suggestion" : "body"}"]`
      )
      field?.focus()
      if (on) field?.select()
    }
    const link = (label: string, onclick: () => void, cls = "cmp-link") =>
      h("button", { class: cls, type: "button", onclick }, label)

    return h(
      "form",
      {
        class: `${cls} composer`,
        "data-card": "composer",
        onsubmit: (e: Event) => {
          e.preventDefault()
          void submit(draft)
        },
      },
      commenter
        ? h(
            "div",
            { class: "cmp-head" },
            ...identity.authorLine({
              authorName: commenter.name,
              avatarUrl: commenter.avatarUrl,
              signedIn: true,
            }),
            h("span", { class: "spacer" }),
            link(t("signOut"), () => identity.signOutCommenter())
          )
        : h(
            "div",
            { class: "cmp-head cmp-head-guest" },
            avatar,
            needsName ? nameInput : h("span", { class: "author" }, name),
            h("span", { class: "spacer" }),
            needsName
              ? null
              : link(t("notYou"), () => {
                  identity.forgetName()
                  ctx.dialog.focusAfterRender('[data-focus-key="name"]')
                  ctx.render()
                })
          ),
      suggestInput
        ? renderSuggestion(before!, suggestInput, t("suggestedEdit"), [
            h("span", { class: "spacer" }),
            link(t("removeSuggestion"), () => setSuggesting(false)),
          ])
        : draft.anchor.quote
          ? h("blockquote", { class: "quote" }, draft.anchor.quote.exact)
          : null,
      textarea,
      draft.images.length
        ? h(
            "div",
            { class: "cmp-images" },
            h(
              "div",
              { class: "cmp-thumbs" },
              ...draft.images.map((image, i) =>
                h(
                  "div",
                  { class: "cmp-thumb" },
                  h("img", { src: image.url, alt: t("imageN", { n: i + 1 }) }),
                  h(
                    "button",
                    {
                      class: "cmp-thumb-remove",
                      type: "button",
                      "aria-label": t("removeImage", { n: i + 1 }),
                      title: t("removeImage", { n: i + 1 }),
                      onclick: () => {
                        URL.revokeObjectURL(image.url)
                        draft.images.splice(i, 1)
                        ctx.render()
                      },
                    },
                    icon(ICONS.close)
                  )
                )
              )
            ),
            h("p", { class: "cmp-images-note" }, t("imagesPublic"))
          )
        : null,
      draft.error
        ? h("div", { class: "error cmp-error", role: "alert" }, draft.error)
        : null,
      h(
        "div",
        { class: "cmp-foot" },
        h(
          "span",
          { class: "cmp-keys", title: t("send", { key: ctx.i18n.mod }) },
          h("kbd", {}, ctx.i18n.mod),
          h("kbd", {}, "↵")
        ),
        before !== null && !suggesting
          ? h(
              "button",
              {
                class: "cmp-link cmp-suggest-btn",
                type: "button",
                onclick: () => setSuggesting(true),
              },
              icon(ICONS.edit),
              t("suggestEdit")
            )
          : null,
        attach
          ? h(
              "button",
              {
                class: "icon-btn",
                type: "button",
                "aria-label": t("addImage"),
                title: t("addImage"),
                onclick: () => fileInput?.click(),
              },
              icon(ICONS.image)
            )
          : null,
        attach && canScreenshot(draft)
          ? h(
              "button",
              {
                class: "icon-btn",
                type: "button",
                "aria-label": t("markUpScreenshot"),
                title: t(
                  draft.preparingMarkup
                    ? "preparingScreenshot"
                    : "markUpScreenshot"
                ),
                disabled: Boolean(draft.preparingMarkup),
                onclick: () => void markUpScreenshot(draft),
              },
              icon(ICONS.pen)
            )
          : null,
        fileInput,
        counter,
        h("span", { class: "spacer" }),
        post
      ),
      // Shown in the header, but after the comment in tab order, like Cancel.
      commenter
        ? null
        : h(
            "button",
            {
              class: "cmp-link cmp-sign-in",
              type: "button",
              title: t("signInGithub"),
              onclick: () =>
                identity.openDashboard("commentSignIn", "nuni-comment-sign-in"),
            },
            icon(ICONS.github),
            t("signIn")
          ),
      // Last in tab order, so Tab goes from the name to the comment.
      h(
        "button",
        {
          class: "icon-btn cmp-close",
          type: "button",
          "aria-label": t("cancel"),
          title: t("cancel"),
          onclick: () => ctx.closeCard(),
        },
        icon(ICONS.close)
      )
    )
  }

  return {
    /** Start a comment on what was picked. */
    open(target: PinTarget) {
      // A comment on selected text skips picking, so show the pins here too.
      ctx.pins.setHidden(false, true)
      const draft: Draft = {
        ...target,
        suggestFrom: suggestableText(target.anchor, target.element),
        body: "",
        name: "",
        images: [],
      }
      if (config.capture.dom) {
        try {
          draft.dom = domContext(target.element)
        } catch {
          // Context is a bonus; never block a comment on it.
        }
      }
      ctx.dialog.focusAfterRender(
        `[data-focus-key="${ctx.identity.nameFor(false) ? "body" : "name"}"]`
      )
      ctx.setCard({ kind: "composer", draft })
      draft.screenshot = takeScreenshot(draft)
    },

    render,

    /** Words or images that haven't been posted: a press outside keeps the card. */
    unsent(draft: Draft): boolean {
      const after = draft.suggesting
        ? (draft.suggestion ?? draft.suggestFrom)
        : ""
      return Boolean(draft.body.trim() || after?.trim() || draft.images.length)
    },

    /** The previews of a closed comment box are no longer shown. */
    discard(draft: Draft) {
      for (const image of draft.images) URL.revokeObjectURL(image.url)
    },
  }
}

export const COMPOSER_CSS = /* css */ `
.composer {
  display: grid;
  transition: box-shadow 140ms ease, border-color 140ms ease;
}
.composer:focus-within {
  border-color: color-mix(in srgb, var(--n-accent) 45%, var(--n-border));
  box-shadow: 0 0 0 4px var(--n-accent-soft), var(--n-shadow);
}
.composer.sheet:focus-within { border-color: var(--n-border); box-shadow: var(--n-shadow); }
.composer .spacer { flex: 1; }
.cmp-head { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 10px 44px 4px 14px; }
.avatar-empty { background: var(--n-bg-subtle); color: var(--n-fg-muted); }
.avatar-empty .icon { width: 14px; height: 14px; }
.cmp-name {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  outline: none;
  font-weight: 600;
}
.cmp-link {
  border: 0;
  background: none;
  padding: 2px 4px;
  border-radius: 6px;
  color: var(--n-fg-muted);
  font-size: 12px;
  white-space: nowrap;
}
.cmp-link:hover { color: var(--n-fg); }
.cmp-head-guest { padding-right: 116px; }
.cmp-sign-in { position: absolute; top: 13px; right: 44px; height: 32px; display: inline-flex; align-items: center; gap: 4px; }
.cmp-sign-in .icon { width: 13px; height: 13px; }
.signed-in-as { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.composer .quote, .composer .suggest { margin: 6px 14px 0; }
.suggest {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--n-bg-subtle);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.suggest-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  color: var(--n-fg-muted);
  font-size: 12px;
  font-weight: 550;
}
.suggest .cmp-link { margin-left: auto; padding: 0 4px; }
.suggest del, .item-suggest del { color: var(--n-fg-muted); text-decoration-color: var(--n-danger); }
.suggest ins, .item-suggest ins {
  color: var(--n-fg);
  text-decoration: none;
  background: var(--n-accent-soft);
  border-radius: 4px;
}
.suggest ins { padding: 1px 3px; justify-self: start; }
.cmp-suggest {
  display: block;
  width: 100%;
  max-height: 160px;
  padding: 4px 6px;
  border: 1px solid var(--n-border);
  border-radius: 6px;
  background: var(--n-bg);
  outline: none;
  resize: none;
  line-height: 1.4;
}
.cmp-suggest:focus { border-color: var(--n-accent); }
.cmp-suggest-btn { display: inline-flex; align-items: center; gap: 4px; }
.cmp-images { display: grid; gap: 4px; padding: 6px 14px 0; }
.cmp-thumbs { display: flex; flex-wrap: wrap; gap: 6px; }
.cmp-thumb { position: relative; }
.cmp-thumb img, .images img {
  display: block;
  width: 64px;
  height: 48px;
  object-fit: cover;
  border: 1px solid var(--n-border);
  border-radius: 6px;
  background: var(--n-bg-subtle);
}
.cmp-thumb-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--n-border);
  border-radius: 999px;
  background: var(--n-bg);
  color: var(--n-fg-muted);
}
.cmp-thumb-remove .icon { width: 12px; height: 12px; }
.cmp-images-note { margin: 0; color: var(--n-fg-muted); font-size: 12px; }
.cmp-suggest-btn .icon { width: 13px; height: 13px; }
.cmp-text {
  display: block;
  width: 100%;
  min-height: 76px;
  max-height: 240px;
  padding: 8px 14px;
  border: 0;
  background: none;
  outline: none;
  resize: none;
  line-height: 1.5;
}
.cmp-name::placeholder, .cmp-text::placeholder { color: var(--n-fg-muted); opacity: 1; }
.cmp-name::placeholder { font-weight: 500; }
.cmp-error { padding: 0 14px 4px; }
.cmp-foot { display: flex; align-items: center; gap: 8px; padding: 6px 8px 8px 14px; }
.cmp-keys { display: inline-flex; gap: 3px; }
.cmp-keys kbd {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 4px;
  border: 1px solid var(--n-border);
  border-bottom-width: 2px;
  border-radius: 5px;
  color: var(--n-fg-muted);
  font: 500 11px/1 var(--n-font);
}
.cmp-count { color: var(--n-fg-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.cmp-post {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--n-accent);
  color: var(--n-accent-fg);
  font-weight: 600;
  font-size: 13px;
}
.cmp-post:hover { filter: brightness(1.08); }
.cmp-post:disabled { opacity: 0.4; cursor: default; filter: none; }
.cmp-close { position: absolute; top: 13px; right: 8px; }
@media (hover: none) { .cmp-keys { display: none; } }
`
