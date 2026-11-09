import type { AgentOutputEvent } from '@theokit/presenter'

import type { DisplaySettings } from './display-config.js'

/**
 * The progress lines a platform's resolved display settings let a turn send (B-370). With
 * `tool_progress` and `live_status` off and reasoning hidden, `lines` returns nothing and the
 * turn's one reply is all the channel sees.
 */
export interface ProgressGate {
  /** Lines to send now for one output event. */
  lines(event: AgentOutputEvent): string[]
  /** Lines still held back when the stream ends (buffered reasoning). */
  flush(): string[]
}

function preview(input: unknown, length: number): string {
  if (length <= 0) return ''
  const text = typeof input === 'string' ? input : JSON.stringify(input) ?? ''
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > length ? `${flat.slice(0, length)}…` : flat
}

/**
 * Incognito (`THEOCLAW_INCOGNITO=on`) sends only a tool's name and a status word: no tool input
 * preview, no status detail and no reasoning, since those carry the turn's content.
 */
export function createProgressGate(shown: DisplaySettings, incognito = false): ProgressGate {
  const display: DisplaySettings = incognito ? { ...shown, show_reasoning: false, tool_preview_length: 0 } : shown
  let lastTool: string | undefined
  let reasoning = ''
  const reasoningLine = (): string[] => {
    const text = reasoning.trim()
    reasoning = ''
    if (!display.show_reasoning || text === '') return []
    return [display.reasoning_style === 'subtext' ? `-# ${text.replace(/\s+/g, ' ')}` : text]
  }
  return {
    lines(event) {
      if (event.type === 'reasoning') {
        if (display.show_reasoning) reasoning += event.text
        return []
      }
      const out = reasoningLine()
      if (event.type === 'tool-call' && display.tool_progress !== 'off') {
        if (display.tool_progress === 'all' || event.name !== lastTool) {
          const detail = display.live_status === 'full' ? preview(event.input, display.tool_preview_length) : ''
          out.push(detail === '' ? event.name : `${event.name} ${detail}`)
        }
        lastTool = event.name
      } else if (event.type === 'status' && display.live_status !== 'off') {
        out.push(display.live_status === 'full' && !incognito && event.detail ? `${event.status}: ${event.detail}` : event.status)
      }
      return out
    },
    flush: reasoningLine,
  }
}
