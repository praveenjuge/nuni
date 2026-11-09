import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { NuniError } from "./errors"

/** One entry in credentials.json, keyed by project ID. */
export interface SavedCredential {
  token: string
  ownerName?: string
  projectName?: string
  expiresAt?: number
}

/** The session token to use, and whether it came from $NUNI_TOKEN. */
export interface Credential {
  token: string
  source: "env" | "saved"
}

type Store = Record<string, SavedCredential>

export function configDir(): string {
  if (process.env.NUNI_CONFIG_DIR) return process.env.NUNI_CONFIG_DIR
  const base =
    process.env.XDG_CONFIG_HOME ||
    (process.platform === "win32" && process.env.APPDATA) ||
    join(homedir(), ".config")
  return join(base, "nuni")
}

export function credentialsPath(): string {
  return join(configDir(), "credentials.json")
}

function read(): Store {
  const path = credentialsPath()
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw new NuniError(`Couldn't read ${path}: ${(error as Error).message}`)
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    value = null
  }
  if (value && typeof value === "object") return value as Store
  throw new NuniError(`${path} is not valid JSON. Delete it and log in again.`)
}

function write(store: Store) {
  const dir = configDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = credentialsPath()
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
  // writeFileSync keeps the mode of an existing file.
  chmodSync(path, 0o600)
}

export function credentialFor(publicId: string): Credential | null {
  if (process.env.NUNI_TOKEN) {
    return { token: process.env.NUNI_TOKEN, source: "env" }
  }
  const saved = read()[publicId]
  return saved?.token ? { token: saved.token, source: "saved" } : null
}

export function saveCredential(publicId: string, credential: SavedCredential) {
  write({ ...read(), [publicId]: credential })
}

/** Forget the saved session for a project, returning it, if there was one. */
export function removeCredential(publicId: string): SavedCredential | null {
  const store = read()
  const saved = store[publicId]
  if (!saved) return null
  delete store[publicId]
  write(store)
  return saved
}
