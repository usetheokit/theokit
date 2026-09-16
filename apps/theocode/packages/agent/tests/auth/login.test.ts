/**
 * Finding #46 — `login.ts` at 6.25% of 32 lines, the second-least-covered file in `src/auth/`.
 *
 * What is covered here is every path that REFUSES, plus the round trip that writes and removes a
 * credential. Those are the paths a user meets when something is wrong, and each one exists to stop
 * a specific bad outcome: an empty key written to the store, a key filed under a provider nobody
 * confirmed, and — the expensive one — an existing credential silently overwritten by a second
 * `login`.
 *
 * WHAT IS DELIBERATELY NOT COVERED: the device-code flow inside `loginWithDevice`. `oauthDeviceLogin`
 * is exercised only up to its own guards; past them it hands off to `@theokit/agents/auth` with an
 * injectable `fetch`/`sleep`/`now`, and driving it would mean asserting against a hand-built model of
 * another package's polling protocol. That is a test of the fixture, not of this file. It is named
 * here rather than left as an unexplained gap.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CredentialError, authFilePath } from '../../src/auth/credentials.js'
import { knownProviders, login, logout, methodsFor, oauthDeviceLogin } from '../../src/auth/login.js'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-login-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('signing in with an API key', () => {
  it('test_login_refuses_a_credential_that_would_overwrite_an_existing_one', () => {
    // Anti-vacuity floor, and the refusal with the highest cost if it were dropped: the store holds
    // ONE credential, so a second `login` without `overwrite` would replace a working sign-in with
    // no warning and no way back. Removing this guard leaves every other test in this file green.
    login('sk-ant-first', home)
    const before = readFileSync(authFilePath(home), 'utf8')

    expect(() => login('sk-ant-second', home)).toThrow(CredentialError)
    expect(readFileSync(authFilePath(home), 'utf8'), 'the stored credential was replaced').toBe(
      before,
    )
  })

  it('test_login_writes_the_credential_and_reports_the_provider_it_inferred', () => {
    const result = login('sk-ant-abc', home)

    expect(result.provider).toBe('anthropic')
    expect(result.path).toBe(authFilePath(home))
    expect(existsSync(result.path)).toBe(true)
  })

  it('test_login_refuses_an_empty_key', () => {
    // Whitespace only is still empty. Writing it produces a store that LOOKS signed in and fails on
    // the first request, which is the worst of both.
    expect(() => login('   ', home)).toThrow(/empty/)
    expect(existsSync(authFilePath(home))).toBe(false)
  })

  it('test_login_refuses_a_key_whose_provider_cannot_be_told', () => {
    // No declared prefix matches, so filing it under a provider would be a guess — and a key stored
    // against the wrong provider fails at request time with an error about the wrong service.
    expect(() => login('gsk_something_else', home)).toThrow(CredentialError)
    expect(existsSync(authFilePath(home))).toBe(false)
  })

  it('test_login_honours_a_provider_passed_explicitly', () => {
    // The escape hatch for a key whose prefix says nothing — a proxy, or a provider added later.
    expect(login('sk-ant-abc', home, { provider: 'anthropic' }).provider).toBe('anthropic')
  })

  it('test_login_replaces_the_credential_when_overwrite_is_asked_for', () => {
    login('sk-ant-first', home)

    expect(login('sk-ant-second', home, { overwrite: true }).provider).toBe('anthropic')
    expect(readFileSync(authFilePath(home), 'utf8')).toContain('sk-ant-second')
  })
})

describe('signing out', () => {
  it('test_logout_reports_false_when_there_was_nothing_to_remove', () => {
    // The caller prints "signed out" on `true`. Returning it for a home with no credential would
    // tell a user a state changed when none did.
    expect(logout(home)).toBe(false)
  })

  it('test_logout_removes_the_stored_credential_and_reports_it', () => {
    login('sk-ant-abc', home)

    expect(logout(home)).toBe(true)
    expect(existsSync(authFilePath(home))).toBe(false)
    expect(logout(home), 'a second logout still claimed to remove something').toBe(false)
  })
})

describe('the providers that offer a device login', () => {
  it('test_a_provider_without_a_device_login_is_refused_by_name', async () => {
    // `anthropic` is a supported provider for API keys and offers no device flow. The refusal has
    // to say so and point at `login`; falling through would start a flow against a provider with no
    // endpoint to talk to.
    await expect(oauthDeviceLogin('anthropic', home, { onPrompt: () => {} })).rejects.toThrow(
      /does not offer an OAuth device login/,
    )
  })

  it('test_the_known_providers_are_the_ones_that_can_be_asked_for_methods', () => {
    expect(knownProviders()).toEqual(['openai'])
    expect(methodsFor('openai').length).toBeGreaterThan(0)
  })

  it('test_asking_for_the_methods_of_an_unknown_provider_is_refused', () => {
    expect(() => methodsFor('nope')).toThrow(CredentialError)
  })
})
