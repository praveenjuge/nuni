import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { isProjectId, projectIdsIn } from "@nuni/shared"

import { NuniError } from "./errors"

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
  scan: while (queue.length) {
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
      if (++files > MAX_FILES) break scan
      let text: string
      try {
        text = readFileSync(path, "utf8")
      } catch {
        continue
      }
      for (const id of projectIdsIn(text)) {
        if (!found.has(id)) {
          found.set(id, relative(cwd, path))
        }
      }
    }
  }
  return Array.from(found, ([id, file]) => ({ id, file }))
}

/** A project ID given on the command line or in $NUNI_PROJECT, checked. */
export function checkProjectId(id: string): string {
  if (!isProjectId(id)) {
    throw new NuniError(
      `"${id}" is not a valid Nuni project ID (expected nuni_ followed by 22 characters).`
    )
  }
  return id
}

export interface ProjectRef {
  id: string
  /** Where it came from: the flag, the env var, or the file it was found in. */
  source: string
}

/**
 * The project to work on: --project, then $NUNI_PROJECT, then the one ID
 * found in the code.
 */
export function resolveProject(
  flag: string | undefined,
  cwd: string
): ProjectRef {
  if (flag) return { id: checkProjectId(flag), source: "--project" }
  if (process.env.NUNI_PROJECT) {
    return {
      id: checkProjectId(process.env.NUNI_PROJECT),
      source: "NUNI_PROJECT",
    }
  }
  const found = findProjectIds(cwd)
  if (found.length === 1) return { id: found[0]!.id, source: found[0]!.file }
  if (!found.length) {
    throw new NuniError(
      `No Nuni project ID found in ${cwd}. Run this in the project that uses Nuni, or pass --project nuni_...`
    )
  }
  throw new NuniError(
    `Found more than one Nuni project ID. Pass one with --project:\n${found
      .map((p) => `  ${p.id}  (${p.file})`)
      .join("\n")}`
  )
}
