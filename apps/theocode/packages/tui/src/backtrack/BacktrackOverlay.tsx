import { BacktrackOverlay as FrameworkBacktrackOverlay } from '@theokit/tui'
import { type ReactElement } from 'react'

function overlayHeader(selected: number, count: number): string {
  return selected >= 0
    ? `↑ backtrack: message ${String(selected + 1)}/${String(count)} — Enter to edit · Esc for older`
    : `↑ backtrack: ${String(count)} message(s) — Esc selects (newest first)`
}

export interface BacktrackOverlayProps {
  previews: string[]
  selected: number
  count: number
  maxRows?: number
}

/** The framework overlay with this product's header; the list, window and border are the library's. */
export function BacktrackOverlay({
  previews,
  selected,
  count,
  maxRows = 7,
}: BacktrackOverlayProps): ReactElement | null {
  return (
    <FrameworkBacktrackOverlay
      previews={previews}
      selected={selected}
      maxRows={maxRows}
      header={overlayHeader(selected, count)}
    />
  )
}
