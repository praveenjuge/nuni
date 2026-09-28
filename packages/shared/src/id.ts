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
