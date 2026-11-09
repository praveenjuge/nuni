/**
 * Gives every public package the root package.json version, and makes their
 * dependencies on each other ask for that version.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { publicPackages } from "./public-packages"

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
  version?: string
}
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Root package.json needs a valid semver version")
}

const packages = publicPackages()
const names = new Set(packages.map((pkg) => pkg.name))
for (const { dir, json } of packages) {
  json.version = version
  for (const name of Object.keys(json.dependencies ?? {})) {
    if (names.has(name)) json.dependencies![name] = `^${version}`
  }
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(json, null, 2)}\n`)
}
