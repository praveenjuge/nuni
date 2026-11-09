/**
 * Site owners mark private areas with this attribute. Their text never
 * reaches Nuni: not in the pin anchor (which is public), the markup snippet
 * or the screenshot.
 */
export const MASK_ATTRIBUTE = "data-nuni-mask"
export const MASK_SELECTOR = `[${MASK_ATTRIBUTE}]`

/**
 * Nuni's own UI on the page: the widget puts this attribute on its host
 * element, and nothing inside it is page content (anchors never read its
 * text or attach to it). Not `data-nuni`: that one is a test id site
 * owners put on their own elements, as the docs say.
 */
export const WIDGET_ATTRIBUTE = "data-nuni-widget"
export const WIDGET_SELECTOR = `[${WIDGET_ATTRIBUTE}]`

/**
 * Classes the widget adds to the page's own elements (`nuni-picking` on
 * <html> while picking). They come and go, so anchors never record them.
 */
export const WIDGET_CLASS_PREFIX = "nuni-"
