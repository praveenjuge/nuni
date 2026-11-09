import { h } from "./dom"
import type { Ctx } from "./widget"

const TOAST_MS = 2400

export type Dialog = ReturnType<typeof createDialog>

/**
 * Focus inside the widget, the "are you sure?" dialog and the toast.
 *
 * The UI is rebuilt on every render, so an element to focus is named by its
 * `data-focus-key`: focus (and a text box's selection) moves to the element
 * with the same key in the new UI.
 */
export function createDialog(ctx: Ctx) {
  /**
   * Where focus was before a card or the panel opened, to go back to: a
   * page element or a pin, or the focus key of a widget button.
   */
  let returnFocus: HTMLElement | string | null = null
  /** Focus this (a selector in the UI) after the next render. */
  let focusNext: string | null = null
  let confirming: {
    message: string
    action: string
    done: (ok: boolean) => void
    /** Focus key of the button that asked, to go back to on Cancel. */
    from: string | null
  } | null = null
  let toast: string | null = null
  let toastTimer = 0

  const byKey = (key: string) =>
    ctx.ui.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)

  const answer = (ok: boolean) => {
    const asked = confirming
    if (!asked) return
    confirming = null
    if (!ok && asked.from) focusNext = `[data-focus-key="${asked.from}"]`
    ctx.render()
    asked.done(ok)
  }

  return {
    get asking() {
      return confirming !== null
    },
    answer,

    /** An "are you sure?" dialog inside the widget. */
    ask(message: string, action: string): Promise<boolean> {
      confirming?.done(false)
      const from =
        (ctx.root.activeElement as HTMLElement | null)?.dataset.focusKey ?? null
      return new Promise((resolve) => {
        confirming = { message, action, done: resolve, from }
        focusNext = '[data-focus-key="confirm-cancel"]'
        ctx.render()
      })
    },

    toast(message: string) {
      toast = message
      clearTimeout(toastTimer)
      toastTimer = window.setTimeout(() => {
        toast = null
        ctx.render()
      }, TOAST_MS)
      ctx.render()
    },

    focusAfterRender(selector: string) {
      focusNext = selector
    },

    /** Remember where focus was, before moving it into the widget. */
    keepFocus() {
      if (returnFocus) return
      const inside = ctx.root.activeElement as HTMLElement | null
      if (inside) {
        returnFocus = inside.dataset.focusKey ?? inside
        return
      }
      const active = document.activeElement as HTMLElement | null
      returnFocus =
        active && active !== document.body && active !== ctx.host
          ? active
          : null
    },

    /** Focus goes where the visitor pressed, not back to where it was. */
    dropFocus() {
      returnFocus = null
    },

    /** Back to where focus was before (when that is still there). */
    restoreFocus() {
      const back = returnFocus
      returnFocus = null
      const target = typeof back === "string" ? byKey(back) : back
      if (target?.isConnected) target.focus({ preventScroll: true })
    },

    /** Tab stays inside an open card, the panel or a dialog. */
    trapFocus(e: KeyboardEvent) {
      if (e.key !== "Tab") return
      const from = e.composedPath()[0] as HTMLElement | undefined
      const box = from?.closest?.<HTMLElement>(".confirm, [data-card], .panel")
      if (!box) return
      const items = Array.from(
        box.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, textarea, a[href], [tabindex="0"]'
        )
      ).filter((el) => !el.closest("[hidden]"))
      if (!items.length) return
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = ctx.root.activeElement
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    },

    /**
     * Swap the UI for `nodes`, keeping focus (and a text box's selection)
     * on the element with the same focus key.
     */
    replaceUi(nodes: Node[]) {
      if (toast) nodes.push(h("div", { class: "toast", role: "status" }, toast))
      if (confirming) nodes.push(renderConfirm(confirming))
      const focused = ctx.root.activeElement as HTMLElement | null
      const focusKey = focused?.dataset.focusKey
      const selection =
        focused instanceof HTMLTextAreaElement ||
        focused instanceof HTMLInputElement
          ? { start: focused.selectionStart, end: focused.selectionEnd }
          : null
      ctx.ui.replaceChildren(...nodes)
      const wanted = focusNext
        ? ctx.ui.querySelector<HTMLElement>(focusNext)
        : null
      focusNext = null
      if (wanted) wanted.focus()
      else if (focusKey) {
        const next = byKey(focusKey)
        next?.focus()
        if (
          selection &&
          (next instanceof HTMLTextAreaElement ||
            next instanceof HTMLInputElement)
        ) {
          next.setSelectionRange(selection.start, selection.end)
        }
      }
    },

    stop() {
      clearTimeout(toastTimer)
    },
  }

  function renderConfirm(c: NonNullable<typeof confirming>) {
    return h(
      "div",
      { class: "confirm-backdrop", onclick: () => answer(false) },
      h(
        "div",
        {
          class: "confirm",
          role: "alertdialog",
          "aria-modal": "true",
          "aria-labelledby": "nuni-confirm-text",
          onclick: (e: Event) => e.stopPropagation(),
        },
        h("p", { id: "nuni-confirm-text" }, c.message),
        h(
          "div",
          { class: "row" },
          h("span", { class: "spacer" }),
          h(
            "button",
            {
              class: "btn btn-ghost",
              type: "button",
              "data-focus-key": "confirm-cancel",
              onclick: () => answer(false),
            },
            ctx.t("cancel")
          ),
          h(
            "button",
            {
              class: "btn btn-danger-solid",
              type: "button",
              "data-focus-key": "confirm-ok",
              onclick: () => answer(true),
            },
            c.action
          )
        )
      )
    )
  }
}

export const DIALOG_CSS = /* css */ `
.confirm-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.32);
  pointer-events: auto;
}
.confirm {
  width: min(360px, calc(100vw - 32px));
  padding: 16px;
  border-radius: var(--n-radius);
  background: var(--n-bg);
  color: var(--n-fg);
  border: 1px solid var(--n-border);
  box-shadow: var(--n-shadow);
  display: grid;
  gap: 12px;
}
.confirm p { margin: 0; }

.toast {
  position: fixed;
  left: 50%;
  bottom: 72px;
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--n-fg);
  color: var(--n-bg);
  font-size: 13px;
  box-shadow: var(--n-shadow);
  pointer-events: none;
}
`
