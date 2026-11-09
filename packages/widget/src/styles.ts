import { MOBILE_MAX_WIDTH } from "./dom"

/** The default brand color (the `accentColor` option replaces it). */
export const ACCENT = "#d6246e"

/** The dark theme: the system's, or `theme: "dark"`. */
const DARK = /* css */ `
  --n-bg: #1d1b20;
  --n-bg-subtle: #2a272e;
  --n-fg: #f4f2f6;
  --n-fg-muted: #a8a2ae;
  --n-border: rgba(255, 255, 255, 0.12);
  --n-accent: #ff4d94;
  --n-accent-soft: rgba(255, 77, 148, 0.18);
  --n-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 12px 32px rgba(0,0,0,0.5);
`

/** Tokens, theme and the controls every part uses. */
export const BASE_CSS = /* css */ `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: none;
  color-scheme: light dark;
  --n-bg: #ffffff;
  --n-bg-subtle: #f6f5f7;
  --n-fg: #1c1a1f;
  --n-fg-muted: #6c6773;
  --n-border: rgba(28, 26, 31, 0.12);
  --n-accent: ${ACCENT};
  --n-accent-fg: #ffffff;
  --n-accent-soft: rgba(214, 36, 110, 0.12);
  --n-ok: #1f9d55;
  --n-danger: #d93025;
  --n-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.12);
  --n-radius: 12px;
  --n-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-family: var(--n-font);
  font-size: 14px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
@media (prefers-color-scheme: dark) {
  :host(:not([data-theme="light"])) { ${DARK} }
}
:host([data-theme="dark"]) { ${DARK} }
:host([data-theme="light"]) { color-scheme: light; }
:host([data-theme="dark"]) { color-scheme: dark; }
*, *::before, *::after { box-sizing: border-box; }
button, input, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--n-accent); outline-offset: 2px; }
.icon { display: inline-flex; width: 16px; height: 16px; flex: none; }
.icon svg { width: 100%; height: 100%; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.quote {
  margin: 0;
  padding: 2px 0 2px 10px;
  border-left: 3px solid var(--n-accent);
  color: var(--n-fg-muted);
  font-style: italic;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 4.5em;
  overflow: hidden;
}
/* Cards (composer + thread) */
.card {
  position: fixed;
  width: 340px;
  max-width: calc(100vw - 24px);
  background: var(--n-bg);
  color: var(--n-fg);
  border: 1px solid var(--n-border);
  border-radius: 14px;
  box-shadow: var(--n-shadow);
  pointer-events: auto;
  overflow: hidden;
}
.card-body { padding: 12px 14px; display: grid; gap: 10px; }
.card[data-card="thread"] { display: flex; flex-direction: column; max-height: calc(100vh - 24px); }
.card .quote {
  margin: 0;
  padding: 6px 10px;
  border-left: 0;
  border-radius: 8px;
  background: var(--n-accent-soft);
  color: var(--n-fg);
  font-style: normal;
  font-size: 13px;
  box-shadow: inset 2px 0 0 var(--n-accent);
}
.card-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.card-head .spacer { flex: 1; }
.avatar {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  position: relative;
  overflow: hidden;
}
.avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.signed-in { display: inline-flex; flex: none; color: var(--n-fg-muted); }
.signed-in .icon { width: 13px; height: 13px; }
.author { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { color: var(--n-fg-muted); font-size: 12px; white-space: nowrap; }
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--n-bg-subtle);
  color: var(--n-fg-muted);
  font-size: 11px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge .icon { width: 12px; height: 12px; }
.badge-ok { background: rgba(31,157,85,0.14); color: var(--n-ok); }
.badge-owner { background: var(--n-accent-soft); color: var(--n-accent); }
.comment-body { white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
.icon-btn {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--n-fg-muted);
  flex: none;
  transition: background 120ms ease, color 120ms ease;
}
.icon-btn:hover { background: var(--n-bg-subtle); color: var(--n-fg); }
.icon-btn:disabled { opacity: 0.4; cursor: default; background: none; }
.icon-btn-danger:hover { background: color-mix(in srgb, var(--n-danger) 12%, transparent); color: var(--n-danger); }
.icon-btn.is-resolved, .icon-btn.is-resolved:hover { background: rgba(31,157,85,0.14); color: var(--n-ok); }

/* A message (the comment or a reply): text lines up with the name. */
.msg { gap: 2px; padding: 12px 8px 8px 14px; }
.msg-main { display: grid; gap: 8px; padding: 0 6px 0 34px; min-width: 0; }
.msg .card-head { min-height: 28px; }
.badges { display: flex; flex-wrap: wrap; gap: 4px; }
.msg-foot { display: flex; align-items: center; gap: 2px; margin-right: -6px; }
.msg-foot .spacer { flex: 1; }
/* A reply's tools float over its header on hover, so names never truncate. */
.msg-tools:empty { display: none; }
.msg-tools {
  position: absolute;
  top: 4px;
  right: 8px;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--n-border);
  border-radius: 10px;
  background: var(--n-bg);
  box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08);
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}
.reply:hover .msg-tools, .reply:focus-within .msg-tools { opacity: 1; pointer-events: auto; }
@media (hover: none) {
  .msg-tools { position: static; opacity: 1; pointer-events: auto; padding: 0; border: 0; box-shadow: none; background: none; }
}

/* Shared controls */
.field {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--n-border);
  border-radius: 8px;
  background: var(--n-bg);
  outline: none;
}
.field:focus { border-color: var(--n-accent); box-shadow: 0 0 0 3px var(--n-accent-soft); }
textarea.field { resize: vertical; min-height: 72px; max-height: 240px; }
.row { display: flex; align-items: center; gap: 8px; }
.row .spacer { flex: 1; }
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--n-border);
  background: var(--n-bg);
  font-weight: 550;
  font-size: 13px;
}
.btn:hover { background: var(--n-bg-subtle); }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-primary { background: var(--n-accent); border-color: var(--n-accent); color: var(--n-accent-fg); }
.btn-primary:hover { background: var(--n-accent); filter: brightness(1.05); }
.btn-ghost { border-color: transparent; background: transparent; }
.btn-icon { width: 32px; padding: 0; justify-content: center; }
.btn-danger { color: var(--n-danger); }
/* After .btn, which would otherwise paint over the red with the card's background. */
.btn-danger-solid,
.btn-danger-solid:hover { background: var(--n-danger); border-color: var(--n-danger); color: #fff; }
.btn-danger-solid:hover { filter: brightness(1.08); }
.error { color: var(--n-danger); font-size: 12px; }
`

/** Phones, reduced motion and the toolbar's corner. Last, so they win. */
export const LAYOUT_CSS = /* css */ `
@media (max-width: ${MOBILE_MAX_WIDTH}px) {
  .toolbar { right: 12px; bottom: 12px; }
  .tb-label { display: none; }
  .card.sheet {
    left: 0 !important;
    right: 0;
    bottom: 0;
    top: auto !important;
    width: 100%;
    max-width: none;
    border-radius: 16px 16px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .panel { top: auto; left: 0; right: 0; bottom: 0; width: 100%; max-width: none; height: 70vh; border-radius: 16px 16px 0 0; }
  .pin { width: 32px; height: 32px; margin-top: -32px; }
  .pin::after { content: ""; position: absolute; inset: -8px; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}

/* The toolbar's spot (the position option, or where it was dragged) */
:host([data-position$="left"]) .toolbar { right: auto; left: 16px; }
:host([data-position$="center"]) .toolbar { left: 0; right: 0; width: max-content; margin-inline: auto; }
:host([data-position="top-center"]) .pick-hint { top: auto; bottom: 12px; }
:host([data-position^="top"]) .toolbar { bottom: auto; top: 16px; }
:host([data-position$="left"]) .panel { right: auto; left: 12px; }
:host([data-position^="top"]) .panel { top: 72px; bottom: 12px; }
:host([data-position^="top"]) .toast { bottom: auto; top: 72px; }
@media (max-width: ${MOBILE_MAX_WIDTH}px) {
  :host([data-position$="left"]) .toolbar { left: 12px; }
  :host([data-position^="top"]) .toolbar { top: 12px; }
}
`
