import { Box, Text } from 'ink'
import { WindowedList } from '@theokit/tui'
import { type ReactElement } from 'react'

function overlayHeader(selected: number, count: number): string {
  return selected >= 0
    ? `↑ backtrack: message ${String(selected + 1)}/${String(count)} — Enter to edit · Esc for older`
    : `↑ backtrack: ${String(count)} message(s) — Esc selects (newest first)`
}

function oneLine(text: string, max = 88): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export interface BacktrackOverlayProps {
  previews: string[]
  selected: number
  count: number
  maxRows?: number
}

export function BacktrackOverlay({
  previews,
  selected,
  count,
  maxRows = 7,
}: BacktrackOverlayProps): ReactElement | null {
  if (previews.length === 0) return null
  // B-004 — the window and the hidden-row counts come from the library. The row NUMBERS are
  // formatted in here rather than lost: the header says "message 11/20" and the rows are what it
  // refers to. The border stays too — an overlay has to read as separate from the conversation
  // behind it, and `WindowedList` draws no container by design.
  const rows = previews.map((text, index) => `${String(index + 1)}. ${oneLine(text)}`)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <WindowedList
        rows={rows}
        selected={selected >= 0 ? selected : previews.length - 1}
        window={maxRows}
        header={<Text color="cyan">{overlayHeader(selected, count)}</Text>}
      />
    </Box>
  )
}
