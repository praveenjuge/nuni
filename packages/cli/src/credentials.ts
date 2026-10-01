import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface Credential {
  token: string
  ownerName?: string
  projectName?: string
  expiresAt?: number
}

type Store = Record<string, Credential>

/** ~/.config/nuni, or $XDG_CONFIG_HOME/nuni, or %APPDATA%\nuni on Windows. */
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
  try {
    const value: unknown = JSON.parse(readFileSync(credentialsPath(), "utf8"))
    return value && typeof value === "object" ? (value as Store) : {}
  } catch {
    return {}
  }
}

function write(store: Store) {
  const dir = configDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = credentialsPath()
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
  // writeFileSync keeps the mode of an existing file.
  chmodSync(path, 0o600)
}

/** The session for a project: $NUNI_TOKEN, or the one saved by `nuni login`. */
export function credentialFor(publicId: string): Credential | null {
  if (process.env.NUNI_TOKEN) return { token: process.env.NUNI_TOKEN }
  const saved = read()[publicId]
  if (!saved?.token) return null
  if (saved.expiresAt && saved.expiresAt < Date.now()) return null
  return saved
}

export function saveCredential(publicId: string, credential: Credential) {
  write({ ...read(), [publicId]: credential })
}

export function removeCredential(publicId: string): boolean {
  const store = read()
  if (!store[publicId]) return false
  delete store[publicId]
  write(store)
  return true
}
