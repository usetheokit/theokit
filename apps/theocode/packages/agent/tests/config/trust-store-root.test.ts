/**
 * #72 — the trust store follows `home_dir`, and a decision already made is not asked again.
 *
 * `home_dir` is documented as "the directory this product keeps its state in". The trust store IS
 * this product's state — it records which directories the operator allowed to run code — yet
 * `TRUST_STORE` was a module-level const pinning `homedir()/.theokit`, evaluated at import time. So
 * an operator who set `home_dir = ".claude"` moved their transcripts and left their consent record
 * behind, in a directory the product otherwise no longer used.
 *
 * The second test is the half that matters more. Moving the root without carrying the decisions
 * forward would re-prompt for every directory the operator already trusted, and being asked again
 * about something you already decided is precisely how a person learns to approve without reading —
 * the reasoning `isTrusted` already records for the legacy document, applied to the root.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isTrusted, trustDir, trustStorePath } from '../../src/config/trust-store.js'

let home: string
let project: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-trust-root-'))
  project = mkdtempSync(join(tmpdir(), 'theocode-trust-proj-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

describe('#72 — the trust store lives under the configured home', () => {
  it('test_the_store_follows_the_configured_root', () => {
    expect(trustStorePath({ THEOKIT_HOME: join(home, '.claude') }, home)).toBe(
      join(home, '.claude', 'trusted-dirs.json'),
    )
  })

  it('test_without_the_variable_it_is_the_built_in_default', () => {
    expect(trustStorePath({}, home)).toBe(join(home, '.theokit', 'trusted-dirs.json'))
  })

  it('test_a_decision_made_before_the_root_moved_is_still_honoured', async () => {
    const before = join(home, '.theokit', 'trusted-dirs.json')
    mkdirSync(join(home, '.theokit'), { recursive: true, mode: 0o700 })
    await trustDir(project, before)

    const after = trustStorePath({ THEOKIT_HOME: join(home, '.claude') }, home)
    expect(after).not.toBe(before)
    expect(isTrusted(project, after, home)).toBe(true)
  })

  it('test_the_legacy_root_never_grants_what_it_does_not_hold', () => {
    const after = trustStorePath({ THEOKIT_HOME: join(home, '.claude') }, home)

    // The anti-vacuity floor for the test above: if the fallback returned true for anything, the
    // carry-forward would prove nothing.
    expect(isTrusted(project, after, home)).toBe(false)
  })
})
