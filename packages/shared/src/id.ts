const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const ID_LENGTH = 22
const PREFIX = "nuni_"

const PROJECT_ID = `${PREFIX}[${ALPHABET}]{${ID_LENGTH}}`
const PROJECT_ID_PATTERN = new RegExp(`^${PROJECT_ID}$`)

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

/** Every project ID written in a piece of text (source code), in order. */
export function projectIdsIn(text: string): string[] {
  return Array.from(text.matchAll(new RegExp(PROJECT_ID, "g")), ([id]) => id)
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

const USER_CODE_PATTERN = new RegExp(
  `^[${CODE_ALPHABET}]{4}-[${CODE_ALPHABET}]{4}$`
)

export function isUserCode(value: unknown): value is string {
  return typeof value === "string" && USER_CODE_PATTERN.test(value)
}

/** A code as people type or paste it: extra spaces, lower case. */
export function normalizeUserCode(value: string): string {
  return value.trim().toUpperCase()
}
