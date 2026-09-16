/**
 * B-034 — the route that forces the file store must not discard the variable that LOCATES it.
 *
 * `resolveCredentialForModel` sends `openai-chatgpt/*` down a path that passes `env: {}`, to ignore
 * the API-key environment variables and force the stored OAuth credential. It discards
 * `THEOCODE_HOME` with them — and that is the `homeEnvVar` of the credential store
 * (`oauth-config.ts` -> `ENV_HOME`). The result is asymmetric and user-visible: the first resolution
 * finds the credential under the overridden home, the routed second one looks in the default home
 * and does not.
 *
 * `git show 47eced3 --stat`, the commit B-007 named as its fix, never touched this file.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_HOME_DIR, LEGACY_HOME_DIR } from '../../src/config/home-dir.js'

import {
  authFilePath,
  credentialHome,
  ensureAuthHome,
  installAuthHome,
  resolveCredentialForModel,
} from '../../src/auth/credentials.js'


/**
 * The credential store's directory, pinned so a comment and the code cannot drift apart again.
 *
 * `home-dir.ts` describes `LEGACY_HOME_DIR` as the root this product used "before `home_dir`
 * existed. READ, never written." That is true of config and instructions and FALSE of credentials:
 * `oauth-config.ts` still names it as the store's `dirName`, and `installAuthHome` points the SDK
 * at it, so it is written on every sign-in.
 *
 * The behaviour is right — `credentials.ts` explains why: the SDK's own store is
 * `<home>/.theokit/auth.json`, and sharing one file between two writers is the collision this split
 * avoids. What was wrong was only the claim about it, in the file that defines the roots. A reader
 * who believed that comment would conclude nothing writes there, and tidy up a live credential.
 *
 * So the comment is corrected, and this test is what keeps it corrected: "fixing" `oauth-config.ts`
 * to the current root name would fail here rather than silently move everyone's sign-in.
 */
describe('the credential store lives under the legacy-named root, deliberately', () => {
  it('test_the_store_directory_is_the_legacy_root_not_the_state_root', () => {
    expect(authFilePath(home, {})).toBe(join(home, LEGACY_HOME_DIR, 'auth.json'))
    expect(authFilePath(home, {})).not.toBe(join(home, DEFAULT_HOME_DIR, 'auth.json'))
  })

  it('test_the_state_root_and_the_credential_root_are_different_directories', () => {
    // Anti-vacuity: the assertion above would also hold if the two constants were equal.
    expect(LEGACY_HOME_DIR).not.toBe(DEFAULT_HOME_DIR)
  })
})

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-cred-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

/** Writes a stored api credential under the home named by THEOCODE_HOME. */
function storeCredential(env: Record<string, string | undefined>): void {
  const dir = credentialHome(home, env)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(
    authFilePath(home, env),
    JSON.stringify({ provider: 'anthropic', api_key: 'sk-ant-stored' }),
    { mode: 0o600 },
  )
}

describe('B-034 — the forced-file-store route keeps the store location', () => {
  it('test_an_overridden_home_is_honoured_on_the_ordinary_route', () => {
    // Anti-vacuity floor: if THEOCODE_HOME never worked, the assertion below would prove nothing.
    const env = { THEOCODE_HOME: join(home, 'custom') }
    storeCredential(env)

    return expect(
      resolveCredentialForModel('anthropic/claude-sonnet-4-5', { env, home }),
    ).resolves.toMatchObject({ apiKey: 'sk-ant-stored' })
  })

  it('test_an_overridden_home_is_honoured_on_the_openai_chatgpt_route', async () => {
    const env = { THEOCODE_HOME: join(home, 'custom') }
    storeCredential(env)

    await expect(
      resolveCredentialForModel('openai-chatgpt/gpt-5', { env, home }),
      'the routed resolution discarded THEOCODE_HOME and looked in the default home',
    ).resolves.toMatchObject({ apiKey: 'sk-ant-stored' })
  })
})

/**
 * The SDK reads a DIFFERENT credential store than this product writes, and one variable bridges
 * them. Whether that variable gets SET is the whole of this.
 *
 * The SDK's `openai-chatgpt` provider reads `<home>/.theokit/auth.json`; this product writes
 * `<home>/.theocode/auth.json`. `THEOKIT_AUTH_HOME` overrides the SDK's directory outright, so
 * setting it is what makes a ChatGPT sign-in usable at all.
 *
 * It shipped set on one surface and unset on the other. B-034 correctly stopped `ensureAuthHome`
 * from mutating its argument, and the CLI's bootstrap — whose only purpose was that mutation —
 * kept calling it and threw the answer away. Measured 2026-08-25: `theocode run` reported "no
 * ChatGPT credential found" for a credential the TUI was using in the same second.
 */
describe('installAuthHome points the SDK at this product store', () => {
  it('test_it_WRITES_the_variable_the_sdk_reads', () => {
    // The distinction the two names exist to make. `ensureAuthHome` answers the question and
    // leaves the environment alone; only `installAuthHome` changes what the SDK will find.
    const env: Record<string, string | undefined> = {}

    const answered = ensureAuthHome(env, '/home/u')
    expect(env.THEOKIT_AUTH_HOME, 'ensureAuthHome mutated its argument again').toBeUndefined()

    const installed = installAuthHome(env, '/home/u')
    expect(env.THEOKIT_AUTH_HOME, 'the variable the SDK reads was never set').toBe(installed)
    expect(installed, 'the two disagree about where the store is').toBe(answered)
  })

  it('test_it_points_at_this_products_directory_and_not_the_sdk_default', () => {
    const env: Record<string, string | undefined> = {}

    installAuthHome(env, '/home/u')

    expect(env.THEOKIT_AUTH_HOME, 'the SDK would look in its own store, which we never write').toBe(
      credentialHome('/home/u', {}),
    )
  })

  it('test_an_explicit_override_is_respected_rather_than_overwritten', () => {
    // Someone who set the variable on purpose — a test harness, a second store — must keep it.
    const env: Record<string, string | undefined> = { THEOKIT_AUTH_HOME: '/somewhere/else' }

    expect(installAuthHome(env, '/home/u')).toBe('/somewhere/else')
    expect(env.THEOKIT_AUTH_HOME).toBe('/somewhere/else')
  })
})
