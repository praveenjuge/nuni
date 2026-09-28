import { Nuni } from "@nuni/react"
import { useState } from "react"

import { Link, usePath } from "./router"

// Public project ID for local development. Safe to commit.
// `?project=nuni_...` switches projects (used by the e2e tests).
const PROJECT_ID = (() => {
  const fromUrl = new URLSearchParams(location.search).get("project")
  if (fromUrl) sessionStorage.setItem("playground:project", fromUrl)
  return (
    sessionStorage.getItem("playground:project") ??
    "nuni_JJHAES8DaHHYNVh4JoWWXw"
  )
})()

const plans = [
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

function Home() {
  return (
    <>
      <section className="hero">
        <h1>Build faster with Acme</h1>
        <p className="lead">
          The best way to ship your product. Try pinning a comment to anything
          here.
        </p>
        <div className="hero-actions">
          <Link className="btn btn-primary" href="/pricing">
            See pricing
          </Link>
          <a className="btn" href="#features">
            Learn more
          </a>
        </div>
      </section>
      <section id="features" className="features">
        {["Fast", "Reliable", "Friendly"].map((f) => (
          <article key={f} className="feature">
            <h3>{f}</h3>
            <p>
              Acme is {f.toLowerCase()} by default, so your team can focus on
              the product.
            </p>
          </article>
        ))}
      </section>
    </>
  )
}

function Pricing() {
  return (
    <section className="pricing">
      <h1>Pricing</h1>
      <div className="plans">
        {plans.map((p) => (
          <div key={p.name} className="plan">
            <h3 className="plan-name">{p.name}</h3>
            <p className="price">
              {p.price}
              <span>/mo</span>
            </p>
            <ul>
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <button className="btn" type="button">
              Choose plan
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

function Tasks() {
  const [tasks, setTasks] = useState([
    "Write docs",
    "Fix login bug",
    "Ship pricing page",
    "Review analytics",
  ])
  const [text, setText] = useState("")
  return (
    <section className="tasks">
      <h1>Tasks</h1>
      <form
        className="task-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) setTasks((t) => [text.trim(), ...t])
          setText("")
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="New task"
          aria-label="New task"
        />
        <button className="btn" type="submit">
          Add
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => setTasks((t) => [...t].reverse())}
        >
          Reverse
        </button>
      </form>
      <ul className="task-list">
        {tasks.map((t) => (
          <li key={t} className="task">
            {t}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function App() {
  const path = usePath()
  const page =
    path === "/pricing" ? <Pricing /> : path === "/tasks" ? <Tasks /> : <Home />
  return (
    <>
      <header className="site-header">
        <nav className="nav">
          <Link href="/" className="logo">
            Acme
          </Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/tasks">Tasks</Link>
        </nav>
      </header>
      <main>{page}</main>
      <footer className="site-footer">© Acme Inc. · Nuni playground</footer>
      <Nuni
        project={PROJECT_ID}
        convexUrl={import.meta.env.VITE_CONVEX_URL}
        convexSiteUrl={import.meta.env.VITE_CONVEX_SITE_URL}
        appUrl={import.meta.env.VITE_APP_URL}
      />
    </>
  )
}
