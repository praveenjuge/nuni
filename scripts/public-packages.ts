/**
 * The packages published to npm: the workspaces named in `PACKAGES` from
 * @nuni/shared (the names the prompt, CLI and docs tell people to install).
 *
 *   bun scripts/public-packages.ts --filters   # turbo filters, for release.yml
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { PACKAGES } from "@nuni/shared"

export interface PublicPackage {
  name: string
  dir: string
  /** The parsed package.json. */
  json: {
    name: string
    version: string
    private?: boolean
    dependencies?: Record<string, string>
  }
}

const root = JSON.parse(readFileSync("package.json", "utf8")) as {
  workspaces: string[]
}

function workspaces(): PublicPackage[] {
  return root.workspaces.flatMap((pattern) => {
    const parent = pattern.replace(/\/\*$/, "")
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const dir = join(parent, entry.name)
        try {
          const json = JSON.parse(
            readFileSync(join(dir, "package.json"), "utf8")
          ) as PublicPackage["json"]
          return [{ name: json.name, dir, json }]
        } catch {
          return []
        }
      })
  })
}

export function publicPackages(): PublicPackage[] {
  const names = new Set<string>(Object.values(PACKAGES))
  const all = workspaces()
  for (const pkg of all) {
    if (!pkg.json.private && !names.has(pkg.name))
      throw new Error(
        `${pkg.dir} is not private but not in PACKAGES (packages/shared/src/prompt.ts)`
      )
  }
  // In PACKAGES order, so a package is published after the ones it depends on.
  return [...names].map((name) => {
    const pkg = all.find((candidate) => candidate.name === name)
    if (!pkg) throw new Error(`No workspace for ${name}`)
    return pkg
  })
}

if (import.meta.main && process.argv.includes("--filters")) {
  console.log(
    publicPackages()
      .map((pkg) => `--filter=${pkg.name}`)
      .join(" ")
  )
}
