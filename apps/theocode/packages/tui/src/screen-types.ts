export type Mode = 'chat' | 'plan' | 'ask' | 'select' | 'progress'

export interface ToastPayload {
  message: string
  variant: 'info' | 'success' | 'error'
  durationMs?: number
}

export interface ContentPanel {
  title: string
  body: string
  /**
   * B-011 — unified-diff text, when the panel has one. Kept apart from `body` so the renderer can
   * hand it to the SDK's `DiffViewer` (which documents this exact shape) instead of printing it as
   * one undifferentiated blob: no gutter, no colour, no folding and no scroll.
   */
  patch?: string
}
