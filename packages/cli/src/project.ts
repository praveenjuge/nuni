import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { isProjectId } from "@nuni/shared"

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "target",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".astro",
  ".turbo",
  ".vercel",
  ".cache",
])

const SOURCE_FILE =
  /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html?|php|erb|liquid|hbs|njk|mdx?)$/i
const ID_IN_TEXT = /nuni_[1-9A-HJ-NP-Za-km-z]{22}/g
const MAX_FILES = 5000
const MAX_FILE_BYTES = 512 * 1024

export interface FoundProject {
  id: string
  /** First file it was found in, relative to the search root. */
  file: string
}

/**
 * Project IDs used in this codebase, found by scanning source files (the ID
 * is committed in code, next to <Nuni /> or the script tag).
 */
export function findProjectIds(cwd: string): FoundProject[] {
  const found = new Map<string, string>()
  const queue = [cwd]
  let files = 0
  while (queue.length && files < MAX_FILES) {
    const dir = queue.shift()!
    let entries: string[]
    try {
      entries = readdirSync(dir).sort()
    } catch {
      continue
    }
    for (const name of entries) {
      const path = join(dir, name)
      let stat
      try {
        stat = statSync(path)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith(".")) queue.push(path)
        continue
      }
      if (!SOURCE_FILE.test(name) || stat.size > MAX_FILE_BYTES) continue
      if (++files > MAX_FILES) break
      let text: string
      try {
        text = readFileSync(path, "utf8")
      } catch {
        continue
      }
      for (const [id] of text.matchAll(ID_IN_TEXT)) {
        if (isProjectId(id) && !found.has(id)) {
          found.set(id, relative(cwd, path))
        }
      }
    }
  }
  return Array.from(found, ([id, file]) => ({ id, file }))
}

export class ProjectError extends Error {}

/**
 * The project to work on: --project, then $NUNI_PROJECT, then the one ID
 * found in the code.
 */
export function resolveProject(
  flag: string | undefined,
  cwd: string
): { id: string; source: string } {
  const explicit = flag ?? process.env.NUNI_PROJECT
  if (explicit) {
    if (!isProjectId(explicit)) {
      throw new ProjectError(
        `"${explicit}" is not a valid Nuni project ID (expected nuni_ followed by 22 characters).`
      )
    }
    return { id: explicit, source: flag ? "--project" : "NUNI_PROJECT" }
  }
  const found = findProjectIds(cwd)
  if (found.length === 1) return { id: found[0]!.id, source: found[0]!.file }
  if (!found.length) {
    throw new ProjectError(
      `No Nuni project ID found in ${cwd}. Run this in the project that uses Nuni, or pass --project nuni_...`
    )
  }
  throw new ProjectError(
    `Found more than one Nuni project ID. Pass one with --project:\n${found
      .map((p) => `  ${p.id}  (${p.file})`)
      .join("\n")}`
  )
}
