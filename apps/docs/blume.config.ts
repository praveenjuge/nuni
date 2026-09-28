import { defineConfig } from "blume"

export default defineConfig({
  title: "Nuni",
  description:
    "Pin a comment to anything on your site. Talk it through with your team. Give your agent the context.",
  logo: { image: "/logo.svg", text: "Nuni" },
  theme: {
    accent: "#d6246e",
    radius: "lg",
    mode: "system",
    fonts: { display: "geist", body: "geist", mono: "geist-mono" },
  },
  banner: {
    content: "Nuni v1 is here: Figma-style comments on your real site.",
    link: { text: "Get started", href: "/quickstart" },
    dismissible: true,
    id: "v1",
  },
  agents: { llmsTxt: true },
  deployment: { site: "https://nuni.praveenjuge.com" },
})
