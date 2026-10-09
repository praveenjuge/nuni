import { markUp } from "./markup"
import { captureScreenshot } from "./screenshot"

/**
 * The code loaded on demand once someone comments (a separate chunk for npm
 * users, a separate script for the CDN build): taking the screenshot and
 * marking it up.
 */
export const screenshotTools = { capture: captureScreenshot, markUp }

export type ScreenshotTools = typeof screenshotTools

declare global {
  interface Window {
    /** Set by nuni-screenshot.global.js (the CDN build). */
    __nuniScreenshot?: ScreenshotTools
  }
}
