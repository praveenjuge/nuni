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
  navigation: {
    cta: {
      label: "Sign in",
      href: "https://nuni.praveenjuge.com/dashboard/sign-in",
    },
  },
  agents: { llmsTxt: true },
  deployment: { site: "https://nuni.praveenjuge.com" },
})
