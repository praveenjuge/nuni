import { spawn, spawnSync } from "node:child_process"
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"

import { BACKEND_DIR, URLS, WORKOS, portOf } from "../env"

/**
 * A fresh anonymous Convex project with the backend's code, chosen from this
 * directory alone: never from a developer's packages/backend/.env.local.
 */
const backend = fileURLToPath(
  new URL("../../../packages/backend/", import.meta.url)
)
rmSync(BACKEND_DIR, { recursive: true, force: true })
mkdirSync(`${BACKEND_DIR}/convex`, { recursive: true })
symlinkSync(`${backend}node_modules`, `${BACKEND_DIR}/node_modules`)
const { type, dependencies } = JSON.parse(
  readFileSync(`${backend}package.json`, "utf8")
) as { type: string; dependencies: Record<string, string> }
writeFileSync(
  `${BACKEND_DIR}/package.json`,
  JSON.stringify({ type, dependencies })
)
// Without the backend's convex.json, `convex dev` doesn't provision hosted AuthKit.
writeFileSync(`${BACKEND_DIR}/convex.json`, "{}\n")

const env = {
  ...process.env,
  CONVEX_AGENT_MODE: "anonymous",
  CONVEX_DEPLOYMENT: "",
  CONVEX_DEPLOY_KEY: "",
  CONVEX_DEPLOYMENT_TOKEN: "",
  CONVEX_SELF_HOSTED_URL: "",
  CONVEX_SELF_HOSTED_ADMIN_KEY: "",
}
const ports = [
  "--local-cloud-port",
  String(portOf(URLS.convex)),
  "--local-site-port",
  String(portOf(URLS.convexSite)),
]
function convex(args: string[]) {
  const result = spawnSync("bunx", ["convex", ...args], {
    cwd: BACKEND_DIR,
    env,
    stdio: "inherit",
  })
  if (result.status !== 0) throw new Error(`convex ${args[0]} failed`)
}

// The backend's code needs the WorkOS settings, and they can only be set on
// a deployment that exists: create it with no functions first.
convex(["dev", "--once", ...ports])
const deployment = /^CONVEX_DEPLOYMENT=(anonymous:.*)$/m.exec(
  readFileSync(`${BACKEND_DIR}/.env.local`, "utf8")
)?.[1]
if (!deployment) throw new Error("Refusing a non-anonymous E2E backend")
env.CONVEX_DEPLOYMENT = deployment.trim()
for (const [key, value] of Object.entries({
  WORKOS_CLIENT_ID: WORKOS.clientId,
  WORKOS_API_KEY: WORKOS.apiKey,
  WORKOS_API_URL: URLS.workos,
  WORKOS_WEBHOOK_SECRET: WORKOS.webhookSecret,
  NUNI_ALLOW_TESTING: "1",
}))
  convex(["env", "set", key, value])
cpSync(`${backend}convex`, `${BACKEND_DIR}/convex`, { recursive: true })
convex(["dev", "--once", ...ports])

// Its own process group, so stopping it also stops the local backend binary
// `convex dev` starts (which otherwise outlives it and keeps the ports).
const child = spawn("bunx", ["convex", "dev", ...ports], {
  cwd: BACKEND_DIR,
  env,
  stdio: "inherit",
  detached: true,
})
// The functions are pushed; ready once the watcher's backend answers.
const ready = createServer(async (_request, response) => {
  const up = await fetch(`${URLS.convex}/version`, {
    signal: AbortSignal.timeout(2_000),
  }).then(
    (r) => r.ok,
    () => false
  )
  response.statusCode = up ? 200 : 503
  response.end()
})
ready.listen(portOf(URLS.convexReady), "127.0.0.1")
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    ready.close()
    process.kill(-child.pid!, signal)
  })
child.on("exit", (code) => process.exit(code ?? 1))
