import type { AgentOutputEvent } from '../agent-output-event.js'
import type { Presenter } from '../presenter.js'

/**
 * `TerminalPresenter` (M50) — the terminal surface: the canonical {@link AgentOutputEvent} → plain rows
 * ready for a TTY. Peer of the web `UIMessageStreamPresenter`, sourced from the SAME canonical event, so a
 * terminal agent (exec / CLI / TUI) never re-translates the SDK.
 *
 * Returns DATA (`TerminalRow[]`), never a pre-painted string blob: the row carries its `kind` so an Ink /
 * blessed / raw-TTY renderer decides styling (SRP — format here, render there). ANSI is opt-in via
 * `{ ansi: true }` for consumers that write straight to a stream.
 *
 * @public
 */
export interface TerminalRow {
  /** Semantic kind — the renderer maps it to a style. */
  readonly kind:
    | 'text'
    | 'reasoning'
    | 'tool'
    | 'tool-result'
    | 'tool-error'
    | 'error'
    | 'status'
    | 'finish'
  /** The line content (already one-line-safe; no trailing newline). */
  readonly text: string
}

export interface TerminalPresenterOptions {
  /** Wrap rows in ANSI colors (default `false` — the renderer usually styles). */
  readonly ansi?: boolean
  /** Max width for inlined tool input/result previews (default 88). */
  readonly maxPreview?: number
}

const ANSI: Record<TerminalRow['kind'], string> = {
  text: '',
  reasoning: '\x1b[2m', // dim
  tool: '\x1b[36m', // cyan
  'tool-result': '\x1b[2m',
  'tool-error': '\x1b[31m', // red
  error: '\x1b[31m',
  status: '\x1b[35m', // magenta
  finish: '\x1b[2m',
}
const RESET = '\x1b[0m'

/** One-line, width-capped preview of an arbitrary value (tool input/result). */
function preview(value: unknown, max: number): string {
  const raw = typeof value === 'string' ? value : safeJson(value)
  const flat = raw.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function safeJson(value: unknown): string {
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return typeof value === 'bigint' ? value.toString() : ''
  }
}

/** Build an optional ` (code)` / ` — detail` suffix without nesting template literals. */
function suffix(open: string, value: string | undefined, close: string): string {
  return value === undefined ? '' : open + value + close
}

export class TerminalPresenter implements Presenter<TerminalRow> {
  readonly surface = 'terminal'
  readonly #ansi: boolean
  readonly #max: number

  constructor(options: TerminalPresenterOptions = {}) {
    this.#ansi = options.ansi ?? false
    this.#max = options.maxPreview ?? 88
  }

  present(event: AgentOutputEvent): TerminalRow[] {
    switch (event.type) {
      case 'text':
        return event.text.length > 0 ? [this.#row('text', event.text)] : []
      case 'reasoning':
        return event.text.length > 0 ? [this.#row('reasoning', `\u00b7 ${event.text}`)] : []
      case 'tool-call':
        return [this.#row('tool', `\u23fa ${event.name}(${preview(event.input, this.#max)})`)]
      case 'tool-result':
        return [this.#toolResult(event.isError === true, preview(event.result, this.#max))]
      case 'error':
        return [this.#row('error', `\u2716 ${event.message}${suffix(' (', event.code, ')')}`)]
      case 'status':
        return [
          this.#row('status', `\u25cf ${event.status}${suffix(' \u2014 ', event.detail, '')}`),
        ]
      case 'finish':
        return [this.#row('finish', this.#finishText(event.reason, event.usage?.totalTokens))]
      // `partial-tool-call` streams incremental args — the committed `tool-call` renders them.
      default:
        return []
    }
  }

  #toolResult(isError: boolean, body: string): TerminalRow {
    return this.#row(isError ? 'tool-error' : 'tool-result', `  \u23bf ${body}`)
  }

  #finishText(reason: string | undefined, tokens: number | undefined): string {
    const r = suffix(' ', reason, '')
    const t = tokens === undefined ? '' : ` \u00b7 ${tokens} tokens`
    return `<<${r}${t} >>`
  }

  #row(kind: TerminalRow['kind'], text: string): TerminalRow {
    return { kind, text: this.#ansi && ANSI[kind] !== '' ? `${ANSI[kind]}${text}${RESET}` : text }
  }
}
