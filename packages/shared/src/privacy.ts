/**
 * Site owners mark private areas with this attribute. Their text never
 * reaches Nuni: not in the pin anchor (which is public), the markup snippet
 * or the screenshot.
 */
export const MASK_ATTRIBUTE = "data-nuni-mask"
export const MASK_SELECTOR = `[${MASK_ATTRIBUTE}]`
