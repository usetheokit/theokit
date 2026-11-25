/**
 * One line per tool_call event as the stream gave it: name, status and the whole event, so a failed
 * live run shows what the tool returned (output included) instead of a truncated JSON prefix.
 */
export function toolEventDigest(events: readonly unknown[]): string {
  return events
    .map((event, index) => {
      const record = (event ?? {}) as { readonly name?: unknown; readonly status?: unknown }
      return `#${index} ${String(record.name)} [${String(record.status)}] ${JSON.stringify(event)}`
    })
    .join('\n')
}
