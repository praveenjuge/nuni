import { readFileSync, writeFileSync } from "node:fs"

const root = JSON.parse(readFileSync("package.json", "utf8")) as {
  version?: string
}
const version = root.version
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Root package.json needs a valid semver version")
}

for (const name of ["widget", "react", "cli"]) {
  const path = `packages/${name}/package.json`
  const pkg = JSON.parse(readFileSync(path, "utf8")) as {
    version: string
    dependencies?: Record<string, string>
  }
  pkg.version = version
  if (name === "react" && pkg.dependencies) {
    pkg.dependencies["@nuniapp/widget"] = `^${version}`
  }
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
}
