export const STYLES = /* css */ `
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
  --n-accent: #d6246e;
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
  :host {
    --n-bg: #1d1b20;
    --n-bg-subtle: #2a272e;
    --n-fg: #f4f2f6;
    --n-fg-muted: #a8a2ae;
    --n-border: rgba(255, 255, 255, 0.12);
    --n-accent: #ff4d94;
    --n-accent-soft: rgba(255, 77, 148, 0.18);
    --n-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 12px 32px rgba(0,0,0,0.5);
  }
}
*, *::before, *::after { box-sizing: border-box; }
button, input, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--n-accent); outline-offset: 2px; }
.icon { display: inline-flex; width: 16px; height: 16px; flex: none; }
.icon svg { width: 100%; height: 100%; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* Toolbar */
.toolbar {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: var(--n-bg);
  color: var(--n-fg);
  border: 1px solid var(--n-border);
  box-shadow: var(--n-shadow);
  pointer-events: auto;
}
.tb-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  font-weight: 550;
  white-space: nowrap;
}
.tb-btn:hover { background: var(--n-bg-subtle); }
.tb-btn[aria-pressed="true"] { background: var(--n-accent); color: var(--n-accent-fg); }
.tb-count {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--n-bg-subtle);
  color: var(--n-fg-muted);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tb-btn[aria-pressed="true"] .tb-count { background: rgba(255,255,255,0.25); color: inherit; }

/* Picking */
.pick-hint {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--n-fg);
  color: var(--n-bg);
  font-size: 13px;
  box-shadow: var(--n-shadow);
  pointer-events: none;
}
.highlight {
  position: fixed;
  border: 2px solid var(--n-accent);
  background: var(--n-accent-soft);
  border-radius: 4px;
  pointer-events: none;
  transition: all 60ms ease-out;
}
.highlight-label {
  position: absolute;
  left: -2px;
  bottom: 100%;
  margin-bottom: 4px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--n-accent);
  color: var(--n-accent-fg);
  font: 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Pins */
.pin {
  position: fixed;
  left: 0;
  top: 0;
  width: 28px;
  height: 28px;
  margin: -28px 0 0 0;
  border: 2px solid #fff;
  border-radius: 14px 14px 14px 2px;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  pointer-events: auto;
  cursor: pointer;
  transition: transform 120ms ease;
  will-change: transform;
}
.pin:hover, .pin[data-active="true"] { z-index: 2; }
.pin[data-active="true"] { box-shadow: 0 0 0 3px var(--n-accent), 0 2px 8px rgba(0,0,0,0.25); }
.pin[data-status="resolved"] { opacity: 0.55; filter: grayscale(0.6); }
.pin[data-replies]::after {
  content: attr(data-replies);
  position: absolute;
  top: -6px;
  right: -8px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--n-bg);
  color: var(--n-fg);
  border: 1px solid var(--n-border);
  font-size: 10px;
  line-height: 14px;
  text-align: center;
}
.pin[data-confidence="low"] { border-style: dashed; }
.pin[hidden] { display: none; }
.pin-pending { opacity: 0.7; }

/* Cards (composer + thread) */
.card {
  position: fixed;
  width: 320px;
  max-width: calc(100vw - 24px);
  background: var(--n-bg);
  color: var(--n-fg);
  border: 1px solid var(--n-border);
  border-radius: var(--n-radius);
  box-shadow: var(--n-shadow);
  pointer-events: auto;
  overflow: hidden;
}
.card-body { padding: 12px; display: grid; gap: 10px; }
.card[data-card="thread"] { display: flex; flex-direction: column; max-height: calc(100vh - 24px); }
.thread { border-top: 1px solid var(--n-border); display: grid; min-height: 0; }
.replies { display: grid; gap: 12px; padding: 12px; overflow-y: auto; max-height: 45vh; }
.reply { display: grid; gap: 6px; }
.avatar-sm { width: 20px; height: 20px; font-size: 9px; }
.badge-owner { background: var(--n-accent-soft); color: var(--n-accent); }
.reply-form { display: flex; align-items: flex-end; gap: 8px; padding: 8px 12px 12px; flex-wrap: wrap; }
.reply-form .field { flex: 1 1 100%; }
/* A fixed size: growing on focus would move the Send button mid-click. */
.reply-form .field-reply { flex: 1 1 0; min-height: 56px; height: 56px; resize: none; }
.reactions { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; position: relative; }
.reaction {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--n-border);
  border-radius: 999px;
  background: var(--n-bg);
  color: var(--n-fg);
  font-size: 12px;
}
.reaction:hover { background: var(--n-bg-subtle); }
.reaction[aria-pressed="true"] { border-color: var(--n-accent); background: var(--n-accent-soft); }
.reaction-add { color: var(--n-fg-muted); padding: 0 6px; }
.reaction-picker {
  display: flex;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--n-border);
  border-radius: 999px;
  background: var(--n-bg);
  box-shadow: var(--n-shadow);
}
.reaction-picker .reaction { border-color: transparent; font-size: 14px; }
.btn-xs { width: 24px; height: 24px; }
.card-head { display: flex; align-items: center; gap: 8px; }
.card-head .spacer { flex: 1; }
.avatar {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.author { font-weight: 600; }
.meta { color: var(--n-fg-muted); font-size: 12px; }
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
.badge-ok { background: rgba(31,157,85,0.14); color: var(--n-ok); }
.comment-body { white-space: pre-wrap; word-break: break-word; }
.shot {
  display: block;
  border: 1px solid var(--n-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--n-bg-subtle);
}
.shot img { display: block; width: 100%; max-height: 160px; object-fit: cover; object-position: top; }
.shot-preview { display: grid; gap: 4px; }
.shot-preview img {
  display: block;
  width: 100%;
  max-height: 200px;
  /* The whole image, so the commenter sees everything that is attached. */
  object-fit: contain;
  border: 1px solid var(--n-border);
  border-radius: 8px;
  background: var(--n-bg-subtle);
}
.shot-note { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--n-fg-muted); }
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
.kbd { color: var(--n-fg-muted); font-size: 11px; }
.error { color: var(--n-danger); font-size: 12px; }
.divider { height: 1px; background: var(--n-border); }
.actions { display: flex; gap: 4px; padding: 8px 12px; border-top: 1px solid var(--n-border); background: var(--n-bg-subtle); }
.actions .spacer { flex: 1; }

/* Panel */
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
.tabs { display: flex; gap: 4px; padding: 8px 12px 0; }
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
.item-text { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
.section-label { padding: 12px 10px 4px; font-size: 11px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: var(--n-fg-muted); }
.empty { padding: 32px 16px; text-align: center; color: var(--n-fg-muted); }
.panel-foot { padding: 12px; border-top: 1px solid var(--n-border); display: grid; gap: 8px; font-size: 13px; }
.link { border: 0; background: none; padding: 0; color: var(--n-accent); font-weight: 600; text-decoration: none; }
.link:hover { text-decoration: underline; }
a.item { color: inherit; text-decoration: none; }

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

@media (max-width: 640px) {
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
`
