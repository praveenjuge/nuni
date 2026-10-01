const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const ID_LENGTH = 22
const PREFIX = "nuni_"

const PROJECT_ID_PATTERN = new RegExp(`^${PREFIX}[${ALPHABET}]{${ID_LENGTH}}$`)

/** Random base58 string using the platform CSPRNG (browser, Node, Convex). */
export function randomBase58(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ""
  for (const byte of bytes) {
    // 58 * 4 = 232, reject above to avoid modulo bias.
    let b = byte
    while (b >= 232) {
      const retry = new Uint8Array(1)
      crypto.getRandomValues(retry)
      b = retry[0]!
    }
    out += ALPHABET[b % 58]
  }
  return out
}

/** Public project identifier, safe to commit into source code. */
export function generateProjectId(): string {
  return PREFIX + randomBase58(ID_LENGTH)
}

export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && PROJECT_ID_PATTERN.test(value)
}

/** Secret used by anonymous commenters to edit/delete their own comments. */
export function generateSecret(): string {
  return randomBase58(32)
}

/** Letters that can't be confused or spell words, for codes people compare. */
const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"

/** A short code like "BCDF-GHJK", shown in the terminal and the dashboard. */
export function generateUserCode(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let out = ""
  for (const [i, byte] of bytes.entries()) {
    // 20 * 12 = 240, reject above to avoid modulo bias.
    let b = byte
    while (b >= 240) {
      const retry = new Uint8Array(1)
      crypto.getRandomValues(retry)
      b = retry[0]!
    }
    out += (i === 4 ? "-" : "") + CODE_ALPHABET[b % 20]
  }
  return out
}

export function isUserCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(value)
  )
}
