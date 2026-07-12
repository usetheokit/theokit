/**
 * Opt-in debug logging for agent-run runtime metrics (the wiring-triad "runtime metric" pillar).
 *
 * These metrics are observable proof the decorators fired, but emitting them to stdout unconditionally
 * corrupts any stdout consumer — a `@theokit/tui` Ink render, a piped log, a JSON pipeline (G9: no
 * unconditional `console.*` in production paths). Gate them behind `THEOKIT_DEBUG` so the observability is
 * preserved (set `THEOKIT_DEBUG=1` to see the M7/M8/mainloop wiring metrics) while the default is silent.
 */
export function debugLog(marker: string, data: Record<string, unknown>): void {
  const flag = process.env.THEOKIT_DEBUG
  if (flag !== undefined && flag !== '' && flag !== '0' && flag !== 'false') {
    console.debug(marker, data)
  }
}
