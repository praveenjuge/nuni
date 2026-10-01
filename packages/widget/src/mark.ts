/**
 * Marks Nuni's own screenshot requests (fonts and images it inlines), so the
 * network collector can skip them without muting the page. `Symbol.for` is
 * shared by the widget and the separately loaded screenshot script.
 */
export const CAPTURE_MARK = Symbol.for("nuni.capture")
