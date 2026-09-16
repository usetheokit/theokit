/**
 * `credentialState` answers "is the stored credential usable?", and it used to answer "does the
 * file parse?".
 *
 * Measured 2026-08-25: an OAuth credential whose `expires` had passed ten days earlier produced
 * `✓ credential: present`. A diagnostic whose whole job is to say whether the product is ready to
 * run reported a green tick on the one thing that was going to fail first.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

/**
 * Scratch roots, removed when the file finishes.
 *
 * MEASURED 2026-09-03: /tmp held 2 773 leaked `theocode-*` directories from suites that create one
 * per case and never remove it. Sixteen other test files here already clean up, so this follows the
 * convention rather than inventing one, and the cost of skipping it is paid once per test on every
 * machine that ever runs the suite.
 */
const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

import { credentialState } from '../../src/commands/doctor.js'

const NOW = 1_700_000_000_000

function credentialFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'theocode-doctor-'))
  roots.push(dir)
  const path = join(dir, 'auth.json')
  writeFileSync(path, contents)
  return path
}

describe('credentialState', () => {
  it('test_a_missing_file_is_absent', () => {
    expect(credentialState(join(tmpdir(), 'theocode-does-not-exist', 'auth.json'), NOW)).toBe(
      'absent',
    )
  })

  it('test_a_file_that_does_not_parse_is_unreadable', () => {
    expect(credentialState(credentialFile('{ not json'), NOW)).toBe('unreadable')
  })

  it('test_a_credential_with_no_expiry_is_present', () => {
    // An API key has no expiry at all. Treating a missing field as expired would warn every key
    // user about a problem they cannot have.
    expect(credentialState(credentialFile('{"type":"api","provider":"openai"}'), NOW)).toBe(
      'present',
    )
  })

  it('test_a_credential_whose_expiry_has_passed_is_expired', () => {
    const path = credentialFile(`{"type":"oauth","expires":${NOW - 1}}`)

    expect(credentialState(path, NOW), 'an expired token still reported as present').toBe('expired')
  })

  it('test_a_credential_that_expires_in_the_future_is_present', () => {
    expect(credentialState(credentialFile(`{"type":"oauth","expires":${NOW + 60_000}}`), NOW)).toBe(
      'present',
    )
  })

  it('test_a_non_numeric_expiry_is_not_read_as_expired', () => {
    // A string date would be `<= now` under no comparison that means anything. Refusing to guess
    // is the difference between a diagnostic and a rumour.
    expect(credentialState(credentialFile('{"expires":"2020-01-01"}'), NOW)).toBe('present')
  })
})
