/**
 * B-249 — a configured `agentsDir` that resolves to nothing silently found zero agents.
 *
 * The result was byte-identical to "this app declares no agents": `[]`, and no output. So a
 * deployed `/api/agents/<name>` answered 404 with an empty server log, and an operator had no
 * reason to suspect configuration rather than the agent file.
 *
 * The loudest way in is an ABSOLUTE path — the parameter is a NAME joined onto the project root,
 * so `join()` yields `<root><abs>` and nothing resolves — but a typo, a missing nesting level and
 * a directory a build did not copy all land in the same branch, and one rule covers all four.
 *
 * Placed here rather than at the `packages/theo/tests/unit/` path the alignment brief named:
 * every other `scanAgents` test lives in this directory, and the repo's convention wins over a
 * path written before the convention was checked.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { scanAgents } from '../../packages/theo/src/server/scan/agent-scan.js'

/** Matches the fixture the sibling suite uses: `scanAgents` refuses an agent with no policy. */
const AGENT = "export const policy = 'public'\nexport default {}"

/**
 * A fresh root per case. The suppression set is module-level and never reset — deliberately, since
 * it is what bounds the log — so two cases sharing a path would make the second one's silence
 * indistinguishable from the fix not firing.
 */
function freshRoot(withAgents = false): string {
  const dir = mkdtempSync(join(tmpdir(), 'theo-agents-dir-'))
  if (withAgents) {
    mkdirSync(join(dir, 'agents'), { recursive: true })
    writeFileSync(join(dir, 'agents', 'chat.ts'), AGENT)
  }
  return dir
}

describe('scanAgents reports a configured agentsDir that resolves to nothing (B-249)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('test_a_configured_dir_that_is_absent_is_reported', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const found = scanAgents(freshRoot(), 'nope')

    expect(found, 'the return value moved — every caller reads this as "no agents"').toEqual([])
    const said = warn.mock.calls.flat().join(' ')
    expect(said, 'the configured value is not named, so nobody knows what to correct').toContain(
      'nope',
    )
    expect(said, 'the path it resolved to is not named').toContain('resolves to')
    expect(said, 'the 404 an operator actually sees is not connected to the cause').toContain(
      '/api/agents/*',
    )
  })

  it('test_an_absolute_value_is_reported_with_the_relative_contract_named', () => {
    // How the item was found. `join(root, '/tmp/x')` is `<root>/tmp/x`, so an operator who wrote an
    // absolute path gets a directory that looks right in the config and exists nowhere.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    scanAgents(freshRoot(), '/tmp/definitely-not-here/agents')

    expect(warn.mock.calls.flat().join(' ')).toContain('relative to the project root')
  })

  it('test_nothing_configured_stays_silent', () => {
    // A project with no agents is the ORDINARY case, and a gate that fires on ordinary work is a
    // gate somebody disables. This is why the parameter is optional rather than defaulted.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const found = scanAgents(freshRoot())

    expect(found).toEqual([])
    expect(warn, 'an app that simply declares no agents was warned at').not.toHaveBeenCalled()
  })

  it('test_a_configured_dir_that_exists_says_nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const found = scanAgents(freshRoot(true), 'agents')

    expect(found.length, 'the agent was not found — the fixture or the scan is wrong').toBe(1)
    expect(warn, 'the path that must not get noisier got noisier').not.toHaveBeenCalled()
  })

  it('test_one_report_per_resolved_path_however_many_scans', () => {
    // `scanAgents` runs per request on a scanned deploy target, so an unbounded warning is a log
    // flood on the exact path an anonymous caller can drive.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const dir = freshRoot()

    scanAgents(dir, 'nope')
    scanAgents(dir, 'nope')
    scanAgents(dir, 'nope')

    expect(
      warn.mock.calls,
      'three scans of one missing path produced more than one line',
    ).toHaveLength(1)
  })

  it('test_two_different_missing_paths_are_reported_separately', () => {
    // Keyed by the RESOLVED path rather than by the process: each distinct mistake deserves its own
    // line, and a test harness legitimately scans more than one root.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const dir = freshRoot()

    scanAgents(dir, 'nope-one')
    scanAgents(dir, 'nope-two')

    expect(warn.mock.calls).toHaveLength(2)
  })
})
