/**
 * Publishes each public package whose version npm doesn't have yet. Run from
 * the release workflow after building them.
 */
import { spawnSync } from "node:child_process"

import { publicPackages } from "./public-packages"

for (const { name, dir, json } of publicPackages()) {
  const spec = `${name}@${json.version}`
  const lookup = spawnSync("npm", ["view", spec, "version"], {
    encoding: "utf8",
  })
  if (lookup.status === 0) {
    console.log(`${spec} is already published`)
    continue
  }
  if (!`${lookup.stdout}${lookup.stderr}`.includes("E404")) {
    process.stderr.write(lookup.stderr)
    process.exit(1)
  }
  const publish = spawnSync("npm", ["publish", "--access", "public"], {
    cwd: dir,
    stdio: "inherit",
  })
  if (publish.status !== 0) process.exit(publish.status ?? 1)
}
