/**
 * The entry-point load gate (`check-pack-entry-points-load.mjs`) must say WHY `npm install` of a
 * tarball failed.
 *
 * Release run 38473703093 failed for `@theokit/agents` with only
 * `Command failed: npm install /tmp/load-.../theokit-agents-15.1.1.tgz /tmp/load-siblings-...`: the
 * gate printed the first 110 characters of `err.message`, and those were filled by the argv, so
 * npm's own error never reached the log. A rerun passed, and nobody could tell a registry hiccup
 * from a package that does not install.
 *
 * The gate now prints npm's whole stderr, and retries the install once, printing the first failure
 * in full when the retry succeeds, so a transient error stays visible without failing the release.
 */
import { describe, expect, it } from 'vitest'

import { describeCommandFailure, runWithOneRetry } from '../../scripts/describe-command-failure.mjs'

const LONG_ARGV = `npm install ${'/tmp/load-siblings-abcdef/theokit-presenter-1.0.0.tgz '.repeat(6)}`
const NPM_STDERR = [
  'npm error code ECONNRESET',
  'npm error network aborted',
  'npm error A complete log of this run can be found in: /home/runner/.npm/_logs/debug-0.log',
].join('\n')

/** The shape `execFileSync` throws: the argv in `message`, npm's output in `stderr`. */
function execFailure(): Error & { stderr: Buffer; status: number } {
  return Object.assign(new Error(`Command failed: ${LONG_ARGV}\n${NPM_STDERR}`), {
    stderr: Buffer.from(NPM_STDERR),
    status: 1,
  })
}

describe('the entry-point gate reports why an install failed', () => {
  it('test_the_failure_description_carries_every_line_of_npm_stderr', () => {
    const text = describeCommandFailure(execFailure())

    for (const line of NPM_STDERR.split('\n')) expect(text).toContain(line)
    expect(text).toContain('exit code 1')
  })

  it('test_a_failure_with_no_stderr_falls_back_to_the_whole_message', () => {
    const err = new Error(`Command failed: ${LONG_ARGV}\nspawn npm ETIMEDOUT`)

    expect(describeCommandFailure(err)).toContain('spawn npm ETIMEDOUT')
  })

  it('test_a_transient_failure_is_retried_once_and_its_first_error_is_logged', () => {
    const logged: string[] = []
    let calls = 0

    const result = runWithOneRetry(
      () => {
        calls += 1
        if (calls === 1) throw execFailure()
        return 'installed'
      },
      (line) => logged.push(line),
    )

    expect(result).toBe('installed')
    expect(calls).toBe(2)
    expect(logged.join('\n')).toContain('npm error code ECONNRESET')
  })

  it('test_a_failure_that_repeats_throws_with_both_descriptions', () => {
    let calls = 0
    const attempt = () => {
      calls += 1
      throw execFailure()
    }

    expect(() => runWithOneRetry(attempt, () => {})).toThrow(/ECONNRESET[\s\S]*ECONNRESET/)
    expect(calls).toBe(2)
  })
})
