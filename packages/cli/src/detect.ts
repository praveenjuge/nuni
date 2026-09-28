import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm"

export interface Framework {
  id: string
  name: string
  kind: "react" | "vanilla" | "script"
  /** Where the snippet usually goes, relative to the project root. */
  file: string
}

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readPackage(cwd: string): PackageJson | null {
  try {
    return JSON.parse(
      readFileSync(join(cwd, "package.json"), "utf8")
    ) as PackageJson
  } catch {
    return null
  }
}

function first(cwd: string, candidates: string[], fallback: string): string {
  return candidates.find((c) => existsSync(join(cwd, c))) ?? fallback
}

export function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb")))
    return "bun"
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn"
  return "npm"
}

export function installCommand(pm: PackageManager, pkg: string): string {
  switch (pm) {
    case "bun":
      return `bun add ${pkg}`
    case "pnpm":
      return `pnpm add ${pkg}`
    case "yarn":
      return `yarn add ${pkg}`
    default:
      return `npm install ${pkg}`
  }
}

export function detectFramework(cwd: string): Framework {
  const pkg = readPackage(cwd)
  if (!pkg) {
    const html = existsSync(join(cwd, "index.html"))
      ? "index.html"
      : (readdirSync(cwd).find((f) => f.endsWith(".html")) ?? "index.html")
    return { id: "html", name: "Static HTML", kind: "script", file: html }
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const has = (name: string) => name in deps

  if (has("next")) {
    const app = first(
      cwd,
      [
        "app/layout.tsx",
        "src/app/layout.tsx",
        "app/layout.jsx",
        "src/app/layout.jsx",
        "app/layout.js",
        "src/app/layout.js",
      ],
      ""
    )
    if (app)
      return {
        id: "next-app",
        name: "Next.js (App Router)",
        kind: "react",
        file: app,
      }
    const pages = first(
      cwd,
      [
        "pages/_app.tsx",
        "src/pages/_app.tsx",
        "pages/_app.jsx",
        "src/pages/_app.jsx",
        "pages/_app.js",
      ],
      ""
    )
    if (pages)
      return {
        id: "next-pages",
        name: "Next.js (Pages Router)",
        kind: "react",
        file: pages,
      }
    return {
      id: "next-app",
      name: "Next.js",
      kind: "react",
      file: "app/layout.tsx",
    }
  }
  if (has("@tanstack/react-start")) {
    return {
      id: "tanstack-start",
      name: "TanStack Start",
      kind: "react",
      file: first(
        cwd,
        ["src/routes/__root.tsx", "app/routes/__root.tsx"],
        "src/routes/__root.tsx"
      ),
    }
  }
  if (
    has("@remix-run/react") ||
    has("react-router") ||
    has("@react-router/dev")
  ) {
    return {
      id: "react-router",
      name: "React Router / Remix",
      kind: "react",
      file: first(cwd, ["app/root.tsx", "app/root.jsx"], "app/root.tsx"),
    }
  }
  if (has("gatsby")) {
    return {
      id: "gatsby",
      name: "Gatsby",
      kind: "react",
      file: first(
        cwd,
        ["gatsby-browser.tsx", "gatsby-browser.js"],
        "gatsby-browser.tsx"
      ),
    }
  }
  if (has("nuxt"))
    return {
      id: "nuxt",
      name: "Nuxt",
      kind: "vanilla",
      file: "plugins/nuni.client.ts",
    }
  if (has("@sveltejs/kit"))
    return {
      id: "sveltekit",
      name: "SvelteKit",
      kind: "vanilla",
      file: "src/routes/+layout.svelte",
    }
  if (has("astro"))
    return {
      id: "astro",
      name: "Astro",
      kind: "vanilla",
      file: first(
        cwd,
        ["src/layouts/Layout.astro", "src/layouts/BaseLayout.astro"],
        "src/layouts/Layout.astro"
      ),
    }
  if (has("@angular/core"))
    return {
      id: "angular",
      name: "Angular",
      kind: "vanilla",
      file: "src/main.ts",
    }
  if (has("vue"))
    return {
      id: "vue",
      name: "Vue",
      kind: "vanilla",
      file: first(cwd, ["src/main.ts", "src/main.js"], "src/main.ts"),
    }
  if (has("svelte"))
    return {
      id: "svelte",
      name: "Svelte",
      kind: "vanilla",
      file: first(cwd, ["src/main.ts", "src/main.js"], "src/main.ts"),
    }
  if (has("react")) {
    return {
      id: "react",
      name: "React",
      kind: "react",
      file: first(
        cwd,
        [
          "src/main.tsx",
          "src/main.jsx",
          "src/index.tsx",
          "src/index.jsx",
          "src/App.tsx",
        ],
        "src/main.tsx"
      ),
    }
  }
  return {
    id: "vanilla",
    name: "JavaScript app",
    kind: "vanilla",
    file: first(
      cwd,
      ["src/main.ts", "src/main.js", "src/index.ts", "src/index.js"],
      "src/main.ts"
    ),
  }
}
