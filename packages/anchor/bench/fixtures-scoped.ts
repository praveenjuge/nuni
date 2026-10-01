/**
 * Scenarios for elements in open shadow roots and same-origin iframes, and
 * for layouts that are hard to tell apart: separate mobile and desktop
 * menus, virtualized lists, and a full re-render.
 */
import type { Scenario } from "./fixtures"

const T = "data-bench-target"

const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
  header { padding: 12px 24px; border-bottom: 1px solid #ddd; }
  .banner { height: 180px; background: #fde68a; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 24px; }
  iframe { width: 100%; height: 420px; border: 1px solid #ddd; }
  .desktop-nav { display: flex; gap: 12px; }
  .mobile-nav { display: none; }
  @media (max-width: 600px) {
    .grid { grid-template-columns: 1fr; }
    .desktop-nav { display: none; }
    .mobile-nav { display: grid; }
  }
`

/**
 * Turns <template shadowrootmode> into shadow roots, nested ones too, in
 * case the content was set without declarative shadow DOM parsing.
 */
const ATTACH_SHADOWS = `<script>
(function attach(root) {
  root.querySelectorAll("template[shadowrootmode]").forEach(function (t) {
    var host = t.parentElement
    if (!host || host.shadowRoot) return
    var shadow = host.attachShadow({ mode: "open" })
    shadow.append(t.content.cloneNode(true))
    t.remove()
    attach(shadow)
  })
})(document)
</script>`

function doc(body: string, extraCss = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}${extraCss}</style></head><body>${body}${ATTACH_SHADOWS}</body></html>`
}

function shadow(tag: string, inner: string, attrs = "") {
  return `<${tag}${attrs}><template shadowrootmode="open"><style>:host{display:block;border:1px solid #ddd;padding:16px;border-radius:8px} button{padding:8px 16px}</style>${inner}</template></${tag}>`
}

function escapeAttr(html: string) {
  return html.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
}

interface Plan {
  name: string
  price: string
}

const PLANS: Plan[] = [
  { name: "Starter", price: "$0" },
  { name: "Pro", price: "$20" },
  { name: "Team", price: "$40" },
]

function planCards(plans: Plan[], target: string) {
  return plans
    .map((p) =>
      shadow(
        "plan-card",
        `<h3>${p.name}</h3><p class="price">${p.price}/mo</p><button type="button"${p.name === target ? ` ${T}` : ""}>Choose plan</button>`
      )
    )
    .join("")
}

function componentsPage(o: {
  plans?: Plan[]
  target?: string
  banner?: boolean
}) {
  return doc(`
    <header><a href="/">Acme</a></header>
    ${o.banner ? '<div class="banner">Launch week!</div>' : ""}
    <main><h1>Pricing</h1><section class="grid">${planCards(o.plans ?? PLANS, o.target ?? "")}</section></main>
  `)
}

function nestedPage(o: { target: boolean; extra?: boolean }) {
  const form = shadow(
    "settings-panel",
    `<h2>Settings</h2><form><label>Name <input name="name" placeholder="Your name"></label>
     <button type="button">Cancel</button>
     <button type="submit"${o.target ? ` ${T}` : ""}>Save changes</button></form>`
  )
  const extra = o.extra
    ? shadow(
        "notice-bar",
        `<p>Your trial ends in 3 days.</p><button type="button">Upgrade</button>`
      )
    : ""
  return doc(`
    <header><a href="/">Acme</a></header>
    ${shadow("app-shell", `<nav><a href="/home">Home</a> <a href="/settings">Settings</a></nav>${extra}<main>${form}</main>`)}
  `)
}

const TODOS = [
  "Write docs",
  "Fix login bug",
  "Ship pricing page",
  "Review analytics",
  "Plan launch",
]

function framePage(o: {
  todos?: string[]
  target: string
  banner?: boolean
  frameHeader?: boolean
}) {
  const inner = `<!doctype html><html><head><style>body{margin:0;font:16px system-ui} li{padding:12px;border-bottom:1px solid #eee}</style></head><body>
    ${o.frameHeader ? "<header><h2>Embedded board</h2><p>Updated just now</p></header>" : ""}
    <ul class="todo-list">${(o.todos ?? TODOS)
      .map(
        (t) => `<li class="todo-item"${t === o.target ? ` ${T}` : ""}>${t}</li>`
      )
      .join("")}</ul></body></html>`
  return doc(`
    <header><a href="/">Acme</a></header>
    ${o.banner ? '<div class="banner">Launch week!</div>' : ""}
    <main><h1>Tasks</h1><iframe title="Board" srcdoc="${escapeAttr(inner)}"></iframe></main>
  `)
}

function menusPage(o: { target: "desktop" | "mobile"; links?: string[] }) {
  const links = o.links ?? ["Features", "Pricing", "Docs"]
  const items = (where: "desktop" | "mobile") =>
    links
      .map(
        (l) =>
          `<a href="/${l.toLowerCase()}"${where === o.target && l === "Docs" ? ` ${T}` : ""}>${l}</a>`
      )
      .join("")
  return doc(`
    <header>
      <nav class="desktop-nav" aria-label="Main">${items("desktop")}</nav>
      <nav class="mobile-nav" aria-label="Menu">${items("mobile")}</nav>
    </header>
    <main><h1>Welcome</h1><p>Read the docs to get started.</p></main>
  `)
}

const PEOPLE = [
  "Fox Mulder",
  "Dana Scully",
  "Walter Skinner",
  "John Doggett",
  "Monica Reyes",
  "Alex Krycek",
  "Jeffrey Spender",
  "Marita Covarrubias",
  "Brad Follmer",
  "Diana Fowley",
]
const MORE_PEOPLE = [
  "Gibson Praise",
  "Cassandra Spender",
  "Kersh Alvin",
  "Lois Runtz",
  "Melvin Frohike",
  "Richard Langly",
  "John Byers",
  "Holly Weaver",
  "Leyla Harrison",
  "Bill Mulder",
]

function listPage(people: string[], target: string) {
  return doc(`
    <header><a href="/">Acme</a></header>
    <main><h1>Customers</h1><div class="list" role="list">${people
      .map(
        (p, i) =>
          `<div class="row" role="listitem" style="padding:12px;border-bottom:1px solid #eee"><span class="name"${p === target ? ` ${T}` : ""}>${p}</span> <span class="email">${p.split(" ")[0]!.toLowerCase()}@example.com</span> <span class="role">${i % 3 ? "Member" : "Admin"}</span></div>`
      )
      .join("")}</div></main>
  `)
}

function rerenderPage(build: number, target: string) {
  const c = (name: string) =>
    `${name}_${(build * 7919 + name.length).toString(36)}`
  const wrap = (html: string) =>
    build > 1
      ? `<div class="${c("layout")}"><div class="${c("inner")}">${html}</div></div>`
      : html
  return doc(`
    <header class="${c("header")}"><a href="/">Acme</a></header>
    <main class="${c("main")}">${wrap(`
      <h1>Your projects</h1>
      <ul class="${c("projects")}">${[
        "Website",
        "Mobile app",
        "Docs site",
        "Billing",
      ]
        .map(
          (name) =>
            `<li class="${c("project")}" id="p-${build}-${name.length}"><h3>${name}</h3><button type="button" class="${c("open")}"${name === target ? ` ${T}` : ""}>Open ${name}</button></li>`
        )
        .join("")}</ul>`)}
    </main>
  `)
}

export const scopedScenarios: Scenario[] = [
  {
    name: "web component, page changed around it",
    category: "shadow",
    before: componentsPage({ target: "Pro" }),
    after: componentsPage({ target: "Pro", banner: true }),
    expect: "found",
  },
  {
    name: "web component inserted before target",
    category: "shadow",
    before: componentsPage({ target: "Pro" }),
    after: componentsPage({
      target: "Pro",
      plans: [{ name: "Free", price: "$0" }, ...PLANS],
    }),
    expect: "found",
  },
  {
    name: "web component removed",
    category: "shadow",
    before: componentsPage({ target: "Pro" }),
    after: componentsPage({ plans: PLANS.filter((p) => p.name !== "Pro") }),
    expect: "lost",
  },
  {
    name: "nested shadow roots",
    category: "shadow",
    before: nestedPage({ target: true }),
    after: nestedPage({ target: true, extra: true }),
    expect: "found",
  },
  {
    name: "same-origin iframe, list reordered",
    category: "iframe",
    before: framePage({ target: "Fix login bug" }),
    after: framePage({
      target: "Fix login bug",
      todos: ["Plan launch", "Fix login bug", "Write docs", "Review analytics"],
    }),
    expect: "found",
  },
  {
    name: "same-origin iframe moved down",
    category: "iframe",
    before: framePage({ target: "Review analytics" }),
    after: framePage({
      target: "Review analytics",
      banner: true,
      frameHeader: true,
    }),
    expect: "found",
  },
  {
    name: "iframe item deleted",
    category: "iframe",
    before: framePage({ target: "Ship pricing page" }),
    after: framePage({
      target: "",
      todos: TODOS.filter((t) => t !== "Ship pricing page"),
    }),
    expect: "lost",
  },
  {
    name: "desktop menu, mobile menu also in the DOM",
    category: "duplicates",
    before: menusPage({ target: "desktop" }),
    after: menusPage({
      target: "desktop",
      links: ["Features", "Customers", "Pricing", "Docs"],
    }),
    expect: "found",
  },
  {
    name: "mobile menu, desktop menu also in the DOM",
    category: "duplicates",
    before: menusPage({ target: "mobile" }),
    after: menusPage({
      target: "mobile",
      links: ["Features", "Customers", "Pricing", "Docs"],
    }),
    viewport: { before: [390, 844], after: [390, 844] },
    expect: "found",
  },
  {
    name: "virtualized list scrolled past the row",
    category: "deleted",
    before: listPage(PEOPLE, "Monica Reyes"),
    after: listPage(MORE_PEOPLE, ""),
    expect: "lost",
  },
  {
    name: "whole list re-rendered with new classes and wrappers",
    category: "structure",
    before: rerenderPage(1, "Docs site"),
    after: rerenderPage(2, "Docs site"),
    expect: "found",
  },
]
