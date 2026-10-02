import { spawn, spawnSync } from "node:child_process"
import {
  mkdirSync,
  writeFileSync,
  symlinkSync,
  existsSync,
  readFileSync,
  cpSync,
  mkdtempSync,
} from "node:fs"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
const runtimeRoot = fileURLToPath(new URL("../.runtime", import.meta.url))
mkdirSync(runtimeRoot, { recursive: true })
const runtimeDir = mkdtempSync(`${runtimeRoot}/backend-`)
// Isolate deployment selection and AuthKit provisioning from developer .env.local.
for (const name of ["node_modules"]) {
  const target = fileURLToPath(
    new URL(`../../../packages/backend/${name}`, import.meta.url)
  )
  if (!existsSync(`${runtimeDir}/${name}`))
    symlinkSync(target, `${runtimeDir}/${name}`)
}
const source = fileURLToPath(
  new URL("../../../packages/backend/convex", import.meta.url)
)
cpSync(source, `${runtimeDir}/convex`, { recursive: true })
writeFileSync(`${runtimeDir}/convex.json`, "{}\n")
writeFileSync(
  `${runtimeDir}/package.json`,
  JSON.stringify({
    type: "module",
    dependencies: {
      convex: "*",
      "@convex-dev/workos-authkit": "*",
      "@convex-dev/rate-limiter": "*",
    },
  })
)
const env = {
  ...process.env,
  CONVEX_AGENT_MODE: "anonymous",
  CONVEX_DEPLOYMENT: "",
  CONVEX_DEPLOY_KEY: "",
  CONVEX_DEPLOYMENT_TOKEN: "",
  CONVEX_SELF_HOSTED_URL: "",
  CONVEX_SELF_HOSTED_ADMIN_KEY: "",
}
function run(args: string[], allowFailure = false) {
  const result = spawnSync("bunx", ["convex", ...args], {
    cwd: runtimeDir,
    env,
    stdio: "inherit",
  })
  if (result.status !== 0 && !allowFailure)
    throw new Error(`convex ${args[0]} failed`)
}
run(["dev", "--once"], true)
const localEnv = readFileSync(`${runtimeDir}/.env.local`, "utf8")
if (!/^CONVEX_DEPLOYMENT=anonymous:/m.test(localEnv))
  throw new Error("Refusing a non-anonymous E2E backend")
writeFileSync(
  `${runtimeRoot}/current.json`,
  JSON.stringify({ directory: runtimeDir })
)
env.CONVEX_DEPLOYMENT = localEnv.match(/^CONVEX_DEPLOYMENT=(.*)$/m)![1]!.trim()
for (const [key, value] of Object.entries({
  WORKOS_CLIENT_ID: "client_nuni_local",
  WORKOS_API_KEY: "sk_test_default",
  WORKOS_API_URL: "http://localhost:4100",
  WORKOS_WEBHOOK_SECRET: "whsec_nuni_local",
  NUNI_ALLOW_TESTING: "1",
}))
  run(["env", "set", key, value])
run(["dev", "--once"])
const child = spawn("bunx", ["convex", "dev"], {
  cwd: runtimeDir,
  env,
  stdio: "inherit",
})
const ready = createServer(async (_request, response) => {
  try {
    const result = await fetch("http://127.0.0.1:3210/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "comments:listForPage",
        args: { publicId: "nuni_123456789ABCDEFGHJKLMN", path: "/" },
        format: "json",
      }),
      signal: AbortSignal.timeout(2_000),
    })
    const body = (await result.json()) as { status?: string }
    response.statusCode = result.ok && body.status === "success" ? 200 : 503
  } catch {
    response.statusCode = 503
  }
  response.end("ready")
})
ready.listen(4199, "127.0.0.1")
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    ready.close()
    child.kill(signal)
  })
child.on("exit", (code) => process.exit(code ?? 1))
