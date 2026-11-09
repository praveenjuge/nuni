import type { HandoffMessage } from "@nuni/shared"

/**
 * Give a token to the widget that opened this popup, and close the popup.
 * False when nothing opened it (the widget then sent the page here instead).
 *
 * `origin` only limits which origin may receive the message. The server
 * checked that it is one of the project's sites before minting the token.
 */
export function handOff(origin: string, message: HandoffMessage): boolean {
  const opener = window.opener as Window | null
  if (!opener || opener.closed) return false
  opener.postMessage(message, origin)
  // The message is already queued for the opener; closing doesn't drop it.
  window.close()
  return true
}
