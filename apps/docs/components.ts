import { defineComponents } from "blume"

export default defineComponents({
  layout: {
    // Dogfooding: every docs page has the Nuni widget.
    Footer: { component: "./islands/NuniWidget.tsx", client: "only" },
  },
})
