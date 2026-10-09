/**
 * Every word the widget shows. Override any of them with the `messages`
 * option; `locale` sets how times and counts are written.
 *
 * `{name}` is filled in. A message with forms (`one`, `other`, and `zero`,
 * `two`, `few`, `many` where a language has them) is picked by `{count}`.
 */
export const EN = {
  toolbar: "Nuni comments",
  comment: "Comment",
  addComment: "Add a comment",
  addCommentKey: "Add a comment ({key})",
  cancelAdding: "Cancel adding a comment",
  pickElement: "Pick an element",
  allComments: "All comments",
  openCount: "Comments on this page: {count} open",
  commentSelection: "Comment on the selected text",
  commentSelectionKey: "Comment on the selected text ({key})",
  pickHint: "Click anything to comment, or drag to mark an area",
  pickHintMobile: "Tap anything to comment",
  pickHintKeys: "Arrow keys move, Enter comments, Esc cancels",
  picked: "Selected {element}",

  comments: "Comments",
  close: "Close",
  tabOpen: "Open ({count})",
  tabResolved: "Resolved ({count})",
  tabYours: "Yours ({count})",
  yours: "Yours",
  noYours: "Comments you leave on any page of this site show here.",
  thisPage: "This page",
  statusOpen: "Open",
  loading: "Loading…",
  noOpen: "No open comments on this page.",
  noOpenKey: "No open comments on this page. Press {key} to add one.",
  noResolved: "Nothing resolved yet.",
  notFoundHere: "Couldn't find on this page",
  searchComments: "Search comments",
  noMatches: "No comments match “{query}”.",
  otherPages: "Other pages",
  openOnPage: "{count} open",
  replyCount: { one: "{count} reply", other: "{count} replies" },
  edited: "edited",
  ownSite: "Own this website?",
  claim: "Claim Nuni",

  yourName: "Your name",
  leaveComment: "Leave a comment",
  notYou: "Not you?",
  cancel: "Cancel",
  post: "Post",
  posting: "Posting…",
  save: "Save",
  send: "{key} + Enter",
  charsLeft: {
    one: "{count} character left",
    other: "{count} characters left",
  },
  suggestEdit: "Suggest an edit",
  suggestedEdit: "Suggested edit",
  removeSuggestion: "Remove",
  newText: "New text",
  addNote: "Add a note (optional)",

  pinLabel: "Comment by {name}: {body}",
  commentBy: "Comment by {name}",
  openScreenshot: "Open the screenshot",
  screenshotTaken: "Screenshot taken when the comment was left",
  resolved: "Resolved",
  leftOn: "Left on {origin}",
  approximate: "Approximate",
  approximateHint: "The page changed; this pin is a best guess",
  notFound: "Element not found",
  originallyOn: "Originally on: {text}",
  resolve: "Resolve",
  reopen: "Reopen",
  copyForAgent: "Copy for agent",
  copyNewText: "Copy new text",
  movePin: "Move pin",
  movePinHint: "Click the element this comment is about",
  pinMoved: "Pin moved",
  closeOutdated: "Close as outdated",
  closedOutdated: "Closed as outdated",
  outdated: "Outdated",
  lostHint:
    "This element isn't on the page any more. Move the pin to where it is now, or close the comment if it no longer applies.",
  newTextCopied: "New text copied",
  copyForAgentHint: "Copy for your coding agent",
  loadingContext: "Loading page context…",
  edit: "Edit",
  delete: "Delete",
  owner: "Owner",

  addReaction: "Add a reaction",
  reactions: "Reactions",
  reactWith: "React with {emoji}",
  reply: "Reply",
  replyFirst: "Reply to start a thread",
  sendReply: "Send reply",
  editReply: "Edit reply",
  deleteReply: "Delete reply",

  confirmDeleteComment: "Delete this comment? This can't be undone.",
  confirmDeleteReply: "Delete this reply?",

  added: "Comment added",
  saved: "Saved",
  deleted: "Deleted",
  replyDeleted: "Reply deleted",
  reopened: "Reopened",
  copied: "Copied for your coding agent",
  copyFailed: "Couldn't copy",
  signedIn: "You're signed in as the owner",
  linkGone: "That comment was deleted or is on another page",
  enterName: "Enter your name",
  writeFirst: "Write a comment first",
  changeTextFirst: "Change the text to suggest an edit",
  suggestionTooLong: "Suggestions are limited to {count} characters",
  commentTooLong: "Comments are limited to {count} characters",
  replyTooLong: "Replies are limited to {count} characters",
  postFailed: "Couldn't post the comment",
  replyFailed: "Couldn't post the reply",
  reactFailed: "Couldn't react",
  failed: "Something went wrong",

  justNow: "just now",
}

export type Plural = { other: string } & Partial<
  Record<Intl.LDMLPluralRule, string>
>
export type MessageKey = keyof typeof EN
export type Messages = { [K in MessageKey]: string | Plural }

export interface I18n {
  locale: string | undefined
  t(key: MessageKey, vars?: Record<string, string | number>): string
  /** "5m ago", in the page's language. */
  timeAgo(ts: number, now?: number): string
  /** The modifier key for shortcuts: ⌘ on Apple devices, Ctrl elsewhere. */
  mod: string
}

function isApple(): boolean {
  if (typeof navigator === "undefined") return false
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ??
    navigator.platform ??
    ""
  return /mac|iphone|ipad|ipod/i.test(platform || navigator.userAgent)
}

export function createI18n(
  locale?: string,
  overrides: Partial<Messages> = {}
): I18n {
  const messages: Messages = { ...EN, ...overrides }
  let plural: Intl.PluralRules | null = null
  let relative: Intl.RelativeTimeFormat | null = null
  try {
    plural = new Intl.PluralRules(locale)
    relative = new Intl.RelativeTimeFormat(locale, {
      numeric: "auto",
      style: "narrow",
    })
  } catch {
    // An invalid locale: fall back to the browser's.
    plural = new Intl.PluralRules()
    relative = new Intl.RelativeTimeFormat(undefined, {
      numeric: "auto",
      style: "narrow",
    })
  }

  const t = (key: MessageKey, vars: Record<string, string | number> = {}) => {
    const message = messages[key] ?? EN[key]
    const text =
      typeof message === "string"
        ? message
        : (message[plural!.select(Number(vars.count ?? 0))] ?? message.other)
    return text.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in vars ? String(vars[name]) : match
    )
  }

  const timeAgo = (ts: number, now = Date.now()) => {
    const s = Math.max(0, Math.round((now - ts) / 1000))
    if (s < 45) return t("justNow")
    const m = Math.round(s / 60)
    if (m < 60) return relative!.format(-m, "minute")
    const hr = Math.round(m / 60)
    if (hr < 24) return relative!.format(-hr, "hour")
    const d = Math.round(hr / 24)
    if (d < 30) return relative!.format(-d, "day")
    try {
      return new Date(ts).toLocaleDateString(locale)
    } catch {
      return new Date(ts).toLocaleDateString()
    }
  }

  return { locale, t, timeAgo, mod: isApple() ? "⌘" : "Ctrl" }
}
