export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface AnchorAncestor {
  tag: string
  id?: string
  classes: string[]
  text?: string
}

/** Everything needed to find a commented element again. Version 1. */
export interface Anchor {
  v: 1
  selectors: {
    id?: string
    testId?: string
    css?: string
    path: string
  }
  tag: string
  /** Stable, human-authored classes on the element itself. */
  classes?: string[]
  role?: string
  text: string
  attrs: Record<string, string>
  ancestors: AnchorAncestor[]
  siblingIndex: number
  siblingCount: number
  componentName?: string
  /** Element box in document coordinates at capture time. */
  rect: Rect
  /** Click point inside the element, 0..1 on each axis. */
  offset: { x: number; y: number }
  viewport: {
    w: number
    h: number
    dpr: number
    scrollX: number
    scrollY: number
  }
  docSize: { w: number; h: number }
}

export type CommentStatus = "open" | "resolved"

/** Shape of a comment as the widget receives it. */
export interface WidgetComment {
  _id: string
  _creationTime: number
  status: CommentStatus
  body: string
  authorName: string
  authorKeyHash: string
  page: {
    origin: string
    path: string
    search: string
    hash: string
    title: string
    url: string
  }
  anchor: Anchor
  viewport: { w: number; h: number; dpr: number }
  createdAt: number
  editedAt?: number
  resolvedAt?: number
}
