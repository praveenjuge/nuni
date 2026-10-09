import type { NuniOptions } from "./config"
import { mount, type NuniInstance } from "./mount"

export type { NuniOptions, PageKey, Position, Theme } from "./config"
export { EN as messages, type Messages } from "./i18n"
export type { NuniInstance } from "./mount"
export { VERSION } from "./config"

/**
 * Mount Nuni on the page. Call once on the client. Calling it again with the
 * same project shares the mounted widget; it is removed when every handle is
 * destroyed. A different project replaces it. Each handle only ever tears
 * down the widget it was created for.
 */
export function init(options: NuniOptions): NuniInstance {
  return mount(options, {
    // A separate chunk, fetched only when someone comments.
    loadScreenshot: () => import("./tools").then((m) => m.screenshotTools),
  })
}
