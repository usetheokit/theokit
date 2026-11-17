/**
 * Read any tool result — a string or an object, in either shell dialect — into one view.
 * Pure: no runtime imports.
 */
export type ToolResultView =
  | {
      readonly kind: 'shell'
      readonly stdout: string
      readonly stderr: string
      readonly exitCode?: number
    }
  | { readonly kind: 'diff'; readonly patch: string }
  | { readonly kind: 'error'; readonly error: string; readonly detail?: string }
  | { readonly kind: 'text'; readonly text: string }

type Rec = Readonly<Record<string, unknown>>

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function render(raw: unknown): string {
  try {
    const s = JSON.stringify(raw)
    return typeof s === 'string' ? s : String(raw)
  } catch {
    return String(raw)
  }
}

function looksLikeUnifiedDiff(s: string): boolean {
  return /^@@ .* @@/m.test(s) && (/^--- /m.test(s) || /^diff --git /m.test(s))
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function fromObject(o: Rec, raw: unknown): ToolResultView {
  if (o.ok === false) {
    const error = typeof o.error === 'string' && o.error !== '' ? o.error : 'tool_failed'
    const stderr = o.stderr
    return typeof stderr === 'string' && stderr !== ''
      ? { kind: 'error', error, detail: stderr }
      : { kind: 'error', error }
  }
  const { stdout, stderr } = o
  if (typeof stdout === 'string' || typeof stderr === 'string') {
    const exitCode = num(o.exitCode) ?? num(o.exit_code)
    return {
      kind: 'shell',
      stdout: typeof stdout === 'string' ? stdout : '',
      stderr: typeof stderr === 'string' ? stderr : '',
      ...(exitCode === undefined ? {} : { exitCode }),
    }
  }
  if (o.ok === true && typeof o.diff === 'string') return { kind: 'diff', patch: o.diff }
  return { kind: 'text', text: render(raw) }
}

/** Normalise any tool result (string or object, either shell dialect) into one view. Never throws. */
export function readToolResult(raw: unknown): ToolResultView {
  try {
    if (typeof raw === 'string') {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = undefined
      }
      if (isRecord(parsed)) return fromObject(parsed, parsed)
      if (looksLikeUnifiedDiff(raw)) return { kind: 'diff', patch: raw }
      return { kind: 'text', text: raw }
    }
    if (isRecord(raw)) return fromObject(raw, raw)
    return { kind: 'text', text: render(raw) }
  } catch {
    return { kind: 'text', text: String(raw) }
  }
}
