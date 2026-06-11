/**
 * Log-injection mitigation helper.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 2 / T2.1 + ADR D3.
 * Port of Next.js action-handler.ts:655 `limitUntrustedHeaderValueForLogs`.
 * Truncates excessive length + escapes control characters that could
 * corrupt structured log output or facilitate ANSI escape injection.
 */

const DEFAULT_MAX_LEN = 100

/**
 * Sanitize a possibly-attacker-controlled string before including in log
 * output. Truncates to `maxLen` and escapes non-printable ASCII (\x00-\x1F
 * and \x7F) via `\xNN` notation.
 */
export function limitUntrustedHeaderValueForLogs(
  value: string,
  maxLen: number = DEFAULT_MAX_LEN,
): string {
  const truncated = value.length > maxLen ? `${value.slice(0, maxLen)}…` : value
  // Escape control chars (0x00-0x1F + 0x7F) to prevent log corruption / ANSI injection.
  // Disabling no-control-regex: this regex INTENTIONALLY targets control chars
  // to sanitize them (the rule exists to catch accidental control chars in regexes).
  // eslint-disable-next-line no-control-regex -- intentional control-char scrubber
  return truncated.replace(/[\x00-\x1F\x7F]/g, (ch) => {
    const code = ch.charCodeAt(0)
    return `\\x${code.toString(16).padStart(2, '0').toUpperCase()}`
  })
}
