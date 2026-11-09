import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { CDN_URL, PACKAGES } from "@nuni/shared"

type Kind = "react" | "vanilla" | "script"

interface FrameworkDef {
  id: string
  name: string
  kind: Kind
  /** Any of these dependencies picks it. */
  deps: string[]
  /** Where the snippet goes: the first of these that exists… */
  files: string[]
  /** …else this one. Without it, the framework needs one of `files`. */
  file?: string
  snippet?: (projectId: string) => string
}

const REACT_IMPORT = `import { Nuni } from "${PACKAGES.react}"`
const WIDGET_IMPORT = `import { init } from "${PACKAGES.widget}"`

const nextApp = (projectId: string) => `${REACT_IMPORT}

// Inside <body>, once:
<Nuni project="${projectId}" />`

const BY_KIND: Record<Kind, (projectId: string) => string> = {
  react: (projectId) => `${REACT_IMPORT}

// Render once next to your app's root component:
<Nuni project="${projectId}" />`,
  vanilla: (projectId) => `${WIDGET_IMPORT}

// Once, on the client:
init({ project: "${projectId}" })`,
  script: (projectId) => `<!-- Before </body> on every page -->
<script src="${CDN_URL}" data-project="${projectId}" defer></script>`,
}

const PACKAGE_BY_KIND: Record<Kind, string | null> = {
  react: PACKAGES.react,
  vanilla: PACKAGES.widget,
  script: null,
}

/** In order: the first match wins. */
const FRAMEWORKS: FrameworkDef[] = [
  {
    id: "next-app",
    name: "Next.js (App Router)",
    kind: "react",
    deps: ["next"],
    files: ["tsx", "jsx", "js"].flatMap((ext) => [
      `app/layout.${ext}`,
      `src/app/layout.${ext}`,
    ]),
    snippet: nextApp,
  },
  {
    id: "next-pages",
    name: "Next.js (Pages Router)",
    kind: "react",
    deps: ["next"],
    files: [
      "pages/_app.tsx",
      "src/pages/_app.tsx",
      "pages/_app.jsx",
      "src/pages/_app.jsx",
      "pages/_app.js",
    ],
    snippet: (projectId) => `${REACT_IMPORT}

export default function App({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <Nuni project="${projectId}" />
    </>
  )
}`,
  },
  {
    id: "next-app",
    name: "Next.js",
    kind: "react",
    deps: ["next"],
    files: [],
    file: "app/layout.tsx",
    snippet: nextApp,
  },
  {
    id: "tanstack-start",
    name: "TanStack Start",
    kind: "react",
    deps: ["@tanstack/react-start"],
    files: ["src/routes/__root.tsx", "app/routes/__root.tsx"],
    file: "src/routes/__root.tsx",
  },
  {
    id: "react-router",
    name: "React Router / Remix",
    kind: "react",
    deps: ["@remix-run/react", "react-router", "@react-router/dev"],
    files: ["app/root.tsx", "app/root.jsx"],
    file: "app/root.tsx",
  },
  {
    id: "gatsby",
    name: "Gatsby",
    kind: "react",
    deps: ["gatsby"],
    files: ["gatsby-browser.tsx", "gatsby-browser.js"],
    file: "gatsby-browser.tsx",
    snippet: (projectId) => `${REACT_IMPORT}

export const wrapRootElement = ({ element }) => (
  <>
    {element}
    <Nuni project="${projectId}" />
  </>
)`,
  },
  {
    id: "nuxt",
    name: "Nuxt",
    kind: "vanilla",
    deps: ["nuxt"],
    files: [],
    file: "plugins/nuni.client.ts",
    snippet: (projectId) => `${WIDGET_IMPORT}

export default defineNuxtPlugin(() => {
  init({ project: "${projectId}" })
})`,
  },
  {
    id: "sveltekit",
    name: "SvelteKit",
    kind: "vanilla",
    deps: ["@sveltejs/kit"],
    files: [],
    file: "src/routes/+layout.svelte",
    snippet: (projectId) => `<script>
  import { onMount } from "svelte"
  ${WIDGET_IMPORT}

  onMount(() => init({ project: "${projectId}" }).destroy)
</script>

<slot />`,
  },
  {
    id: "astro",
    name: "Astro",
    kind: "vanilla",
    deps: ["astro"],
    files: ["src/layouts/Layout.astro", "src/layouts/BaseLayout.astro"],
    file: "src/layouts/Layout.astro",
    snippet: (projectId) => `<!-- In your base layout, before </body> -->
<script>
  ${WIDGET_IMPORT}
  init({ project: "${projectId}" })
</script>`,
  },
  {
    id: "angular",
    name: "Angular",
    kind: "vanilla",
    deps: ["@angular/core"],
    files: [],
    file: "src/main.ts",
  },
  {
    id: "vue",
    name: "Vue",
    kind: "vanilla",
    deps: ["vue"],
    files: ["src/main.ts", "src/main.js"],
    file: "src/main.ts",
  },
  {
    id: "svelte",
    name: "Svelte",
    kind: "vanilla",
    deps: ["svelte"],
    files: ["src/main.ts", "src/main.js"],
    file: "src/main.ts",
  },
  {
    id: "react",
    name: "React",
    kind: "react",
    deps: ["react"],
    files: [
      "src/main.tsx",
      "src/main.jsx",
      "src/index.tsx",
      "src/index.jsx",
      "src/App.tsx",
    ],
    file: "src/main.tsx",
  },
  {
    id: "vanilla",
    name: "JavaScript app",
    kind: "vanilla",
    deps: [],
    files: ["src/main.ts", "src/main.js", "src/index.ts", "src/index.js"],
    file: "src/main.ts",
  },
]

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm"

/** In order: the first lockfile found wins; npm otherwise. */
const LOCKFILES: [string, PackageManager][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
]

const ADD: Record<PackageManager, string> = {
  bun: "bun add",
  pnpm: "pnpm add",
  yarn: "yarn add",
  npm: "npm install",
}

/** What `init` prints: the snippet for this project, and where it goes. */
export interface Setup {
  projectId: string
  framework: string
  frameworkId: string
  file: string
  package: string | null
  packageManager: PackageManager
  install: string | null
  snippet: string
}

function dependencies(cwd: string): Set<string> | null {
  let pkg: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  try {
    pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"))
  } catch {
    return null
  }
  return new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }))
}

const STATIC_HTML: FrameworkDef = {
  id: "html",
  name: "Static HTML",
  kind: "script",
  deps: [],
  files: ["index.html"],
}

/** The framework in `cwd` and the file its snippet goes in. */
function locate(cwd: string): { framework: FrameworkDef; file: string } {
  const exists = (file: string) => existsSync(join(cwd, file))
  const deps = dependencies(cwd)
  if (!deps) {
    const file =
      STATIC_HTML.files.find(exists) ??
      readdirSync(cwd).find((f) => f.endsWith(".html")) ??
      "index.html"
    return { framework: STATIC_HTML, file }
  }
  for (const framework of FRAMEWORKS) {
    if (framework.deps.length && !framework.deps.some((d) => deps.has(d))) {
      continue
    }
    const file = framework.files.find(exists) ?? framework.file
    if (file) return { framework, file }
  }
  throw new Error("FRAMEWORKS ends with a catch-all")
}

/**
 * The framework and package manager in `cwd`, and the install steps for
 * them. Without a readable package.json, the site is static HTML.
 */
export function detectSetup(cwd: string, projectId: string): Setup {
  const { framework, file } = locate(cwd)
  const packageManager =
    LOCKFILES.find(([lockfile]) => existsSync(join(cwd, lockfile)))?.[1] ??
    "npm"
  const pkg = PACKAGE_BY_KIND[framework.kind]
  return {
    projectId,
    framework: framework.name,
    frameworkId: framework.id,
    file,
    package: pkg,
    packageManager,
    install: pkg ? `${ADD[packageManager]} ${pkg}@latest` : null,
    snippet: (framework.snippet ?? BY_KIND[framework.kind])(projectId),
  }
}
