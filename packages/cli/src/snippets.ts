import { CDN_URL, PACKAGES } from "@nuni/shared"

import type { Framework } from "./detect"

export function packageFor(framework: Framework): string | null {
  if (framework.kind === "react") return PACKAGES.react
  if (framework.kind === "vanilla") return PACKAGES.widget
  return null
}

export function snippetFor(framework: Framework, projectId: string): string {
  const react = `import { Nuni } from "${PACKAGES.react}"`
  switch (framework.id) {
    case "next-app":
      return `${react}

// Inside <body>, once:
<Nuni project="${projectId}" />`
    case "next-pages":
      return `${react}

export default function App({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <Nuni project="${projectId}" />
    </>
  )
}`
    case "gatsby":
      return `${react}

export const wrapRootElement = ({ element }) => (
  <>
    {element}
    <Nuni project="${projectId}" />
  </>
)`
    case "nuxt":
      return `import { init } from "${PACKAGES.widget}"

export default defineNuxtPlugin(() => {
  init({ project: "${projectId}" })
})`
    case "sveltekit":
      return `<script>
  import { onMount } from "svelte"
  import { init } from "${PACKAGES.widget}"

  onMount(() => init({ project: "${projectId}" }).destroy)
</script>

<slot />`
    case "astro":
      return `<!-- In your base layout, before </body> -->
<script>
  import { init } from "${PACKAGES.widget}"
  init({ project: "${projectId}" })
</script>`
    case "html":
      return `<!-- Before </body> on every page -->
<script src="${CDN_URL}" data-project="${projectId}" defer></script>`
    default:
      if (framework.kind === "react") {
        return `${react}

// Render once next to your app's root component:
<Nuni project="${projectId}" />`
      }
      return `import { init } from "${PACKAGES.widget}"

// Once, on the client:
init({ project: "${projectId}" })`
  }
}
