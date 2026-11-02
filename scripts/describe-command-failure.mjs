/**
 * Helpers for release gates that shell out (`check-pack-entry-points-load.mjs`), so a failed
 * command says WHY it failed.
 *
 * `execFileSync` throws an error whose `message` starts with `Command failed: ` and the whole argv.
 * For `npm install` of several tarballs the argv alone runs past any fixed cut, and the gate that
 * printed the first 110 characters of `message` showed the paths and none of npm's error (release
 * run 38473703093). The child's own output is in `err.stderr`, and that is what a reader needs.
 */

/**
 * Describe a failed `execFileSync` call: its exit code or signal, then every line of the child's
 * stderr. With no stderr captured (a spawn error, a timeout) it falls back to the whole message.
 * @param {unknown} err
 * @returns {string}
 */
export function describeCommandFailure(err) {
  const e =
    /** @type {{ stderr?: unknown, status?: unknown, signal?: unknown, message?: unknown }} */ (
      err ?? {}
    )
  const stderr = e.stderr === undefined || e.stderr === null ? '' : String(e.stderr).trim()
  let head = 'no exit code'
  if (typeof e.status === 'number') head = `exit code ${String(e.status)}`
  else if (typeof e.signal === 'string') head = `killed by ${e.signal}`
  const body = stderr === '' ? String(e.message ?? err).trim() : stderr
  return `${head}\n${body}`
}

/**
 * Run `attempt`, and run it once more if it throws. A failure that the retry clears is written to
 * `log` in full, so a transient registry error stays on the record without failing the gate. A
 * failure that repeats is thrown as one error carrying both descriptions.
 * @template T
 * @param {() => T} attempt
 * @param {(line: string) => void} log
 * @returns {T}
 */
export function runWithOneRetry(attempt, log) {
  let first
  try {
    return attempt()
  } catch (err) {
    first = describeCommandFailure(err)
  }
  try {
    const result = attempt()
    log(`retry succeeded; the first attempt failed with:\n${indent(first)}`)
    return result
  } catch (err) {
    throw new Error(
      `failed twice.\nfirst attempt: ${indent(first)}\nsecond attempt: ${indent(describeCommandFailure(err))}`,
      { cause: err },
    )
  }
}

/** @param {string} text */
function indent(text) {
  return text.replaceAll('\n', '\n      ')
}
