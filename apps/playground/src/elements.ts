/**
 * A web component with an open shadow root, so the e2e tests can pin
 * comments inside shadow DOM.
 */
class AcmeCard extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return
    const plan = this.getAttribute("plan") ?? "Plan"
    const root = this.attachShadow({ mode: "open" })
    const style = document.createElement("style")
    style.textContent = `
      :host { display: block; border: 1px solid #e4e4e7; border-radius: 12px; padding: 16px; }
      h3 { margin: 0 0 4px; }
      button { margin-top: 8px; padding: 8px 14px; border-radius: 8px; border: 1px solid #18181b; background: #fff; }
    `
    const title = document.createElement("h3")
    title.textContent = plan
    const text = document.createElement("p")
    text.textContent = `Everything in ${plan}, billed monthly.`
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = "Subscribe"
    root.append(style, title, text, button)
  }
}

if (!customElements.get("acme-card")) {
  customElements.define("acme-card", AcmeCard)
}

/** A same-origin iframe document (srcdoc inherits the page's origin). */
export const APPROVALS_FRAME = `<!doctype html><html><head><style>
  body { margin: 0; padding: 16px; font: 15px system-ui, sans-serif; }
  li { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #eee; }
  button { padding: 6px 12px; }
</style></head><body>
  <h2>Approvals</h2>
  <ul>
    <li><span>Refund for order #1001</span><button type="button">Approve</button></li>
    <li><span>New seat for Dana</span><button type="button">Approve</button></li>
  </ul>
</body></html>`
