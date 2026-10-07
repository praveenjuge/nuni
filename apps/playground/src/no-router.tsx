// A plain React app: no router, one long page, and content that keeps
// re-rendering, like most dashboards and landing pages.
import { Nuni } from "@nuniapp/react"
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import { BACKEND, OPTIONS, PROJECT_ID } from "./options"
import "./styles.css"

function Uptime() {
  const [started] = useState(() => Date.now())
  const [now, setNow] = useState(started)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])
  return (
    <p className="lead">
      Live for {((now - started) / 1000).toFixed(1)} seconds
    </p>
  )
}

const sections = ["Overview", "Usage", "Billing", "Support"]

function App() {
  return (
    <>
      <header className="site-header">
        <nav className="nav">
          <span className="logo">Acme</span>
        </nav>
      </header>
      <main>
        <section className="hero">
          <h1>One page, no router</h1>
          <Uptime />
        </section>
        {sections.map((name) => (
          <section key={name} className="feature no-router-section">
            <h3>{name}</h3>
            <p>
              Everything about {name.toLowerCase()} lives on this one page, so
              the URL never changes.
            </p>
          </section>
        ))}
      </main>
      <footer className="site-footer">© Acme Inc. · Nuni playground</footer>
      <Nuni project={PROJECT_ID} {...BACKEND} {...OPTIONS} />
    </>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
