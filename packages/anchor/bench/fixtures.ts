/**
 * Pin reliability scenarios. Each scenario renders a realistic marketing /
 * app page "before" a change, captures an anchor on the element marked
 * `data-bench-target`, then renders the page "after" the change and checks
 * whether the engine finds the element marked `data-bench-target` there
 * (or correctly reports it as lost when it was removed).
 *
 * The engine is configured to ignore `data-bench-*` attributes, so the
 * markers are ground truth only.
 */

export interface Scenario {
  name: string
  category: string
  before: string
  after: string
  expect: "found" | "lost"
  viewport?: { before: [number, number]; after: [number, number] }
  scrollBefore?: number
  scrollAfter?: number
  /** Scroll a container (selector) before capture. */
  scrollContainer?: { selector: string; top: number }
}

import { scopedScenarios } from "./fixtures-scoped"

const T = "data-bench-target"

interface Plan {
  name: string
  price: string
  features: string[]
}

interface PageOptions {
  target?: string
  heroCta?: string
  heroCtaTag?: "a" | "button"
  navLinks?: string[]
  navSignupTag?: "button" | "a"
  plans?: Plan[]
  wrapPlans?: number
  todos?: string[]
  orders?: [string, string, string][]
  formInFooter?: boolean
  emailId?: boolean
  faqOpen?: boolean
  faq?: boolean
  banner?: boolean
  cls?: (name: string) => string
  lang?: "en" | "es"
  stateAttrs?: boolean
  scrollBox?: boolean
}

const DEFAULT_PLANS: Plan[] = [
  {
    name: "Starter",
    price: "$0",
    features: ["1 project", "Community support"],
  },
  {
    name: "Pro",
    price: "$20",
    features: ["10 projects", "Email support", "Analytics"],
  },
  {
    name: "Team",
    price: "$40",
    features: ["Unlimited projects", "SSO", "Audit log"],
  },
]

const DEFAULT_TODOS = [
  "Write docs",
  "Fix login bug",
  "Ship pricing page",
  "Review analytics",
  "Plan launch",
]

const DEFAULT_ORDERS: [string, string, string][] = [
  ["#1001", "Fox Mulder", "$120.00"],
  ["#1002", "Dana Scully", "$89.50"],
  ["#1003", "Walter Skinner", "$240.00"],
  ["#1004", "John Doggett", "$15.00"],
  ["#1005", "Monica Reyes", "$310.25"],
]

const ES: Record<string, string> = {
  "Get started": "Comenzar",
  "Book a demo": "Reservar demo",
  "Build faster": "Construye más rápido",
  "The best way to ship your product.":
    "La mejor manera de lanzar tu producto.",
  Features: "Funciones",
  Pricing: "Precios",
  Docs: "Documentación",
  "Sign up": "Registrarse",
  "Choose plan": "Elegir plan",
  Subscribe: "Suscribirse",
  Email: "Correo",
  "Can I cancel?": "¿Puedo cancelar?",
  "Yes, anytime from settings.": "Sí, en cualquier momento.",
}

const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
  .site-header { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #ddd; z-index: 1; }
  .nav { display: flex; gap: 16px; align-items: center; padding: 12px 24px; }
  .nav-links { display: flex; gap: 12px; list-style: none; margin: 0; padding: 0; flex: 1; }
  .hero { padding: 80px 24px; text-align: center; }
  .btn { display: inline-block; padding: 8px 16px; border: 1px solid #333; border-radius: 6px; background: #fff; }
  .plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 24px; }
  .plan { border: 1px solid #ddd; padding: 16px; border-radius: 8px; }
  .banner { height: 200px; background: #fde68a; }
  .todo-list { padding: 0 24px; }
  .scroll-box { height: 120px; overflow: auto; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 16px; border-bottom: 1px solid #eee; }
  @media (max-width: 600px) {
    .plans { grid-template-columns: 1fr; }
    .nav { flex-wrap: wrap; }
    .hero { padding: 32px 16px; }
  }
`

function t(text: string, o: PageOptions) {
  return o.lang === "es" ? (ES[text] ?? text) : text
}

function mark(key: string, o: PageOptions) {
  return o.target === key ? ` ${T}` : ""
}

export function page(o: PageOptions = {}): string {
  const c = o.cls ?? ((n: string) => n)
  const plans = o.plans ?? DEFAULT_PLANS
  const todos = o.todos ?? DEFAULT_TODOS
  const orders = o.orders ?? DEFAULT_ORDERS
  const navLinks = o.navLinks ?? ["Features", "Pricing", "Docs"]
  const heroCta = o.heroCta ?? t("Get started", o)
  const heroTag = o.heroCtaTag ?? "a"
  const signupTag = o.navSignupTag ?? "button"
  const state = (open: boolean) =>
    o.stateAttrs
      ? ` data-state="${open ? "open" : "closed"}" aria-expanded="${open}"`
      : ""

  const planCards = plans
    .map(
      (p) => `
      <div class="${c("plan")}"${state(p.name === "Pro")}>
        <h3 class="${c("plan-name")}">${p.name}</h3>
        <p class="${c("price")}"${mark(`price:${p.name}`, o)}>${p.price}<span class="${c("per")}">/mo</span></p>
        <ul class="${c("features")}">${p.features.map((f) => `<li>${f}</li>`).join("")}</ul>
        <button class="${c("btn")}" type="button"${mark(`plan:${p.name}`, o)}>${t("Choose plan", o)}</button>
      </div>`
    )
    .join("")

  let plansGrid = `<div class="${c("plans")}">${planCards}</div>`
  for (let i = 0; i < (o.wrapPlans ?? 0); i++) {
    plansGrid = `<div class="${c("wrapper")}">${plansGrid}</div>`
  }

  const form = `
    <form class="${c("signup")}">
      <label${o.emailId === false ? "" : ' for="email"'}>${t("Email", o)}</label>
      <input${o.emailId === false ? "" : ' id="email"'} name="email" type="email" placeholder="you@example.com"${mark("email", o)}>
      <button type="submit" class="${c("btn")}"${mark("subscribe", o)}>${t("Subscribe", o)}</button>
    </form>`

  const table = `
    <table class="${c("orders")}">
      <thead><tr><th>Order</th><th>Customer</th><th>Total</th></tr></thead>
      <tbody>${orders
        .map(
          ([id, name, total]) =>
            `<tr><td>${id}</td><td${mark(`customer:${name}`, o)}>${name}</td><td>${total}</td></tr>`
        )
        .join("")}</tbody>
    </table>`

  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <header class="${c("site-header")}">
    <nav class="${c("nav")}">
      <a href="/" class="${c("logo")}">Acme</a>
      <ul class="${c("nav-links")}">${navLinks
        .map(
          (l) =>
            `<li><a href="/${l.toLowerCase().replace(/\s+/g, "-")}"${mark(`nav:${l}`, o)}>${t(l, o)}</a></li>`
        )
        .join("")}</ul>
      ${
        signupTag === "button"
          ? `<button class="${c("btn")} ${c("btn-primary")}"${mark("signup", o)}>${t("Sign up", o)}</button>`
          : `<a class="${c("btn")} ${c("btn-primary")}" href="/signup"${mark("signup", o)}>${t("Sign up", o)}</a>`
      }
    </nav>
  </header>
  <main>
    ${o.banner ? `<div class="${c("banner")}">Launch week! Everything is 50% off.</div>` : ""}
    <section class="${c("hero")}">
      <h1>${t("Build faster", o)}</h1>
      <p class="${c("lead")}">${t("The best way to ship your product.", o)}</p>
      <div class="${c("hero-actions")}">
        <${heroTag} class="${c("btn")} ${c("btn-primary")}"${heroTag === "a" ? ' href="/start"' : ""}${mark("hero-cta", o)}>${heroCta}</${heroTag}>
        <a class="${c("btn")} ${c("btn-secondary")}" href="/demo">${t("Book a demo", o)}</a>
      </div>
    </section>
    <section class="${c("pricing")}">
      <h2>${t("Pricing", o)}</h2>
      ${plansGrid}
    </section>
    ${
      o.faq === false
        ? ""
        : `<section class="${c("faq")}">
      <h2>FAQ</h2>
      <details${o.faqOpen === false ? "" : " open"}>
        <summary${mark("faq-summary", o)}>${t("Can I cancel?", o)}</summary>
        <p${mark("faq-answer", o)}>${t("Yes, anytime from settings.", o)}</p>
      </details>
      <details><summary>Do you offer refunds?</summary><p>Within 30 days.</p></details>
    </section>`
    }
    <section class="${c("tasks")}">
      <h2>Tasks</h2>
      <ul class="${c("todo-list")}">${todos
        .map(
          (todo) =>
            `<li class="${c("todo-item")}"${mark(`todo:${todo}`, o)}>${todo}</li>`
        )
        .join("")}</ul>
    </section>
    <section class="${c("recent-orders")}">
      <h2>Recent orders</h2>
      ${o.scrollBox ? `<div class="${c("scroll-box")}">${table}</div>` : table}
    </section>
    ${o.formInFooter ? "" : form}
  </main>
  <footer class="${c("site-footer")}">
    <p>© Acme Inc.</p>
    <a href="/privacy">Privacy</a>
    ${o.formInFooter ? form : ""}
  </footer>
  </body></html>`
}

const hashed = (seed: string) => (name: string) => {
  let h = 0
  for (const ch of seed + name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `${name.replace(/-(\w)/g, (_, x) => x.toUpperCase())}_${h.toString(36).slice(0, 5)}`
}

export const scenarios: Scenario[] = [
  {
    name: "unchanged page",
    category: "control",
    before: page({ target: "plan:Pro" }),
    after: page({ target: "plan:Pro" }),
    expect: "found",
  },
  {
    name: "copy edit on a unique CTA",
    category: "text",
    before: page({ target: "hero-cta" }),
    after: page({ target: "hero-cta", heroCta: "Start for free" }),
    expect: "found",
  },
  {
    name: "nav link inserted before target",
    category: "structure",
    before: page({ target: "nav:Pricing" }),
    after: page({
      target: "nav:Pricing",
      navLinks: ["Features", "Customers", "Pricing", "Docs"],
    }),
    expect: "found",
  },
  {
    name: "list reordered",
    category: "ordering",
    before: page({ target: "todo:Write docs" }),
    after: page({
      target: "todo:Write docs",
      todos: [
        "Plan launch",
        "Fix login bug",
        "Review analytics",
        "Write docs",
        "Ship pricing page",
      ],
    }),
    expect: "found",
  },
  {
    name: "item before target deleted",
    category: "ordering",
    before: page({ target: "todo:Ship pricing page" }),
    after: page({
      target: "todo:Ship pricing page",
      todos: [
        "Write docs",
        "Ship pricing page",
        "Review analytics",
        "Plan launch",
      ],
    }),
    expect: "found",
  },
  {
    name: "list item renamed slightly",
    category: "text",
    before: page({ target: "todo:Write docs" }),
    after: page({
      target: "todo:Write the docs",
      todos: ["Write the docs", ...DEFAULT_TODOS.slice(1)],
    }),
    expect: "found",
  },
  {
    name: "table re-sorted",
    category: "ordering",
    before: page({ target: "customer:Dana Scully" }),
    after: page({
      target: "customer:Dana Scully",
      orders: [...DEFAULT_ORDERS].sort((a, b) => a[1].localeCompare(b[1])),
    }),
    expect: "found",
  },
  {
    name: "hashed CSS module classes regenerated",
    category: "classes",
    before: page({ target: "plan:Pro", cls: hashed("build-1") }),
    after: page({ target: "plan:Pro", cls: hashed("build-2") }),
    expect: "found",
  },
  {
    name: "wrapper divs added",
    category: "structure",
    before: page({ target: "plan:Team" }),
    after: page({ target: "plan:Team", wrapPlans: 2 }),
    expect: "found",
  },
  {
    name: "form moved to a different parent",
    category: "structure",
    before: page({ target: "subscribe" }),
    after: page({ target: "subscribe", formInFooter: true }),
    expect: "found",
  },
  {
    name: "duplicate card inserted before target",
    category: "duplicates",
    before: page({ target: "plan:Pro" }),
    after: page({
      target: "plan:Pro",
      plans: [
        { name: "Free", price: "$0", features: ["Try it out"] },
        ...DEFAULT_PLANS,
      ],
    }),
    expect: "found",
  },
  {
    name: "desktop to mobile viewport",
    category: "layout",
    before: page({ target: "plan:Team" }),
    after: page({ target: "plan:Team" }),
    viewport: { before: [1440, 900], after: [390, 844] },
    expect: "found",
  },
  {
    name: "mobile to desktop viewport",
    category: "layout",
    before: page({ target: "nav:Docs" }),
    after: page({ target: "nav:Docs" }),
    viewport: { before: [390, 844], after: [1280, 800] },
    expect: "found",
  },
  {
    name: "banner pushes content down",
    category: "layout",
    before: page({ target: "faq-summary" }),
    after: page({ target: "faq-summary", banner: true }),
    expect: "found",
  },
  {
    name: "accordion collapsed after capture",
    category: "visibility",
    before: page({ target: "faq-answer" }),
    after: page({ target: "faq-answer", faqOpen: false }),
    expect: "found",
  },
  {
    name: "input id removed",
    category: "attributes",
    before: page({ target: "email" }),
    after: page({ target: "email", emailId: false }),
    expect: "found",
  },
  {
    name: "page translated",
    category: "text",
    before: page({ target: "hero-cta" }),
    after: page({ target: "hero-cta", lang: "es" }),
    expect: "found",
  },
  {
    name: "button became a link",
    category: "structure",
    before: page({ target: "signup" }),
    after: page({ target: "signup", navSignupTag: "a" }),
    expect: "found",
  },
  {
    name: "captured while scrolled",
    category: "layout",
    before: page({ target: "plan:Starter" }),
    after: page({ target: "plan:Starter" }),
    scrollBefore: 600,
    scrollAfter: 0,
    expect: "found",
  },
  {
    name: "inside a scroll container",
    category: "layout",
    before: page({ target: "customer:Monica Reyes", scrollBox: true }),
    after: page({ target: "customer:Monica Reyes", scrollBox: true }),
    scrollContainer: { selector: ".scroll-box", top: 200 },
    expect: "found",
  },
  {
    name: "runtime state attributes changed",
    category: "attributes",
    before: page({ target: "plan:Pro", stateAttrs: true }),
    after: page({
      target: "plan:Pro",
      stateAttrs: true,
      plans: DEFAULT_PLANS.map((p) => ({ ...p })),
    }).replace(
      /data-state="open" aria-expanded="true"/,
      'data-state="closed" aria-expanded="false"'
    ),
    expect: "found",
  },
  {
    name: "price on the target's card changed",
    category: "text",
    before: page({ target: "plan:Pro" }),
    after: page({
      target: "plan:Pro",
      plans: DEFAULT_PLANS.map((p) =>
        p.name === "Pro" ? { ...p, price: "$25" } : p
      ),
    }),
    expect: "found",
  },
  {
    name: "many items prepended to the list",
    category: "ordering",
    before: page({ target: "todo:Review analytics" }),
    after: page({
      target: "todo:Review analytics",
      todos: [
        ...Array.from({ length: 20 }, (_, i) => `Backlog task ${i + 1}`),
        ...DEFAULT_TODOS,
      ],
    }),
    expect: "found",
  },
  {
    name: "copy edit and hashed classes together",
    category: "combined",
    before: page({ target: "hero-cta", cls: hashed("build-1") }),
    after: page({
      target: "hero-cta",
      cls: hashed("build-2"),
      heroCta: "Start building",
    }),
    expect: "found",
  },
  {
    name: "same text elsewhere after redesign",
    category: "duplicates",
    before: page({ target: "subscribe" }),
    after: page({ target: "subscribe" }).replace(
      "<footer",
      '<aside class="cta"><button type="button" class="btn">Subscribe</button></aside><footer'
    ),
    expect: "found",
  },
  {
    name: "completely different page",
    category: "deleted",
    before: page({ target: "plan:Pro" }),
    after: `<!doctype html><html><body><header><nav><a href="/">Acme</a></nav></header>
      <main><article><h1>About us</h1><p>We are a small team.</p>
      <button type="button">Contact</button></article></main></body></html>`,
    expect: "lost",
  },
  {
    name: "target list item deleted",
    category: "deleted",
    before: page({ target: "todo:Fix login bug" }),
    after: page({ todos: DEFAULT_TODOS.filter((t) => t !== "Fix login bug") }),
    expect: "lost",
  },
  {
    name: "target card removed",
    category: "deleted",
    before: page({ target: "plan:Pro" }),
    after: page({ plans: DEFAULT_PLANS.filter((p) => p.name !== "Pro") }),
    expect: "lost",
  },
  {
    name: "target section removed",
    category: "deleted",
    before: page({ target: "faq-summary" }),
    after: page({ faq: false }),
    expect: "lost",
  },
  ...scopedScenarios,
]
