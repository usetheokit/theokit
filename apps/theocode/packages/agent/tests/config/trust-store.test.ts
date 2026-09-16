/**
 * B-005 — the consent store decides who may execute code, so it is read like a credential.
 *
 * `~/.theokit/trusted-dirs.json` holds two decisions: which directories are trusted, and which hook
 * command lines are pre-approved. A hook is `spawn(cmd, { shell: true, detached: true })`, so anyone
 * who can write that file can run arbitrary commands under this agent the next time it starts.
 *
 * Yet both readers parsed it with no permission check, and `mkdirSync(dir, { mode: 0o700 })` is a
 * no-op when the directory already exists — with no `chmodSync` to repair it. The directory is
 * SHARED with the SDK's transcript root, which is created without a mode, so whoever gets there
 * first sets the permissions and this code never corrected them.
 *
 * The SDK holds its own credential store to exactly the opposite standard (`assertSecureModes`
 * refuses a group/other-writable directory and chmods after creating). That gate is private, which
 * is the exportable half of this finding, tracked upstream as U-4.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isTrusted, trustDir, frameworkPathFor } from '../../src/config/trust-store.js'

let home: string
let store: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-trust-'))
  store = join(home, '.theokit', 'trusted-dirs.json')
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('B-005 — the consent store is created with private permissions', () => {
  it('test_writing_creates_a_0700_directory_and_a_0600_file', async () => {
    // The write path is the framework's `TrustStore` since the facade landed, so the file to inspect
    // is the one it owns. The PROPERTY is unchanged and still asserted here rather than delegated:
    // this product reads that file to decide what may execute, and "the store I read is private" is
    // a boundary fact worth owning even when someone else writes it.
    await trustDir(home, store)

    expect(statSync(join(home, '.theokit')).mode & 0o777).toBe(0o700)
    expect(statSync(frameworkPathFor(store)).mode & 0o777).toBe(0o600)
  })

  it('test_a_pre_existing_world_writable_directory_is_repaired', async () => {
    // The realistic case: the SDK's transcript root created `.theokit` first, without a mode.
    mkdirSync(join(home, '.theokit'), { recursive: true })
    chmodSync(join(home, '.theokit'), 0o777)

    await trustDir(home, store)

    expect(
      statSync(join(home, '.theokit')).mode & 0o777,
      'mkdirSync({ mode }) is a no-op on an existing directory, and nothing chmodded it afterwards, ' +
        'so a world-writable directory kept holding the file that authorises command execution',
    ).toBe(0o700)
  })
})

describe('B-005 — reading refuses an unsafe store', () => {
  it('test_a_group_or_world_writable_store_is_refused', () => {
    mkdirSync(join(home, '.theokit'), { recursive: true })
    writeFileSync(store, JSON.stringify({ trusted: [home] }), { mode: 0o600 })
    chmodSync(store, 0o666)

    expect(
      () => isTrusted(home, store),
      'a store any local user can write was read as authoritative. It decides which hook command ' +
        'lines are pre-approved, and a hook is spawn(cmd, { shell: true }).',
    ).toThrow(/permission|writable/i)
  })

  it('test_a_correctly_permissioned_store_is_read_normally', () => {
    // Anti-vacuity floor: refusing every store would satisfy the assertion above.
    mkdirSync(join(home, '.theokit'), { recursive: true })
    writeFileSync(store, JSON.stringify({ trusted: [home] }), { mode: 0o600 })

    expect(isTrusted(home, store)).toBe(true)
  })

  it('test_an_absent_store_is_not_an_error', () => {
    // A first run has no store, and that means "nothing is trusted yet", not "refuse to start".
    expect(isTrusted(home, join(home, '.theokit', 'does-not-exist.json'))).toBe(false)
  })
})
