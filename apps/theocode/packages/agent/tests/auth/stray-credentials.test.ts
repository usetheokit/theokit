/**
 * #72 — a credential file nothing reads is still a credential file.
 *
 * Measured on disk 2026-09-04: `~/.theokit/auth.json`, 2169 bytes, nine days old, holding the same
 * six keys as the live store — written by the SDK before `installAuthHome` pointed it at ours, and
 * since then read by nothing and rotated by nothing. A refresh token that no code path touches does
 * not stop being a refresh token; it stops being one that anybody notices.
 *
 * This does NOT move the store. Moving a live credential is the one change in this unification that
 * can log an operator out, or worse, resolve to the stale copy — and its only benefit is that the
 * directory listing looks tidier. What the operator needs is to know the file is there.
 *
 * Nothing here reads a credential's CONTENT. Existence and location are the whole answer.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { strayCredentialFiles } from '../../src/auth/stray-credentials.js'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-stray-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function writeAuth(dir: string): string {
  mkdirSync(join(home, dir), { recursive: true, mode: 0o700 })
  const path = join(home, dir, 'auth.json')
  writeFileSync(path, '{"provider":"openrouter","api_key":"redacted"}', { mode: 0o600 })
  return path
}

describe('#72 — credential files outside the one the product uses', () => {
  it('test_a_copy_left_in_another_state_directory_is_reported', () => {
    writeAuth('.theocode')
    const stray = writeAuth('.theokit')

    expect(strayCredentialFiles(home, {})).toEqual([stray])
  })

  it('test_the_authoritative_file_is_never_reported_as_stray', () => {
    writeAuth('.theocode')

    expect(strayCredentialFiles(home, {})).toEqual([])
  })

  it('test_nothing_on_disk_reports_nothing', () => {
    expect(strayCredentialFiles(home, {})).toEqual([])
  })

  it('test_the_configured_root_is_searched_too', () => {
    writeAuth('.theocode')
    const stray = writeAuth('.claude')

    expect(strayCredentialFiles(home, { THEOKIT_HOME: join(home, '.claude') })).toEqual([stray])
  })

  it('test_a_stray_is_reported_even_when_the_real_store_is_absent', () => {
    // Not conditional on being logged in. A leftover credential from an install that was since
    // reset is exactly the copy nobody is looking for.
    const stray = writeAuth('.theokit')

    expect(strayCredentialFiles(home, {})).toEqual([stray])
  })
})
