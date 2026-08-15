/**
 * The disk half of both consent stores, tested directly.
 *
 * `HookApprovalStore` and `PermissionStore` exercise this helper through their own behaviour, and
 * that is where its coverage stopped — which left the one property only visible from here untested.
 * It was found by a review that BROKE the production code and watched the suite stay green: the
 * strongest evidence a test can give about itself.
 *
 * **The temp name was not unique.** It was `Date.now()` + pid; measured, twelve writes from one
 * process produced **one** name. Two writers sharing a temp path race on it, and the second `rename`
 * of an already-renamed temp throws `ENOENT`. Serialised sync calls on one thread hide this —
 * `worker_threads` share a pid and do not.
 *
 * Uniqueness is asserted on the generated NAMES rather than by launching writers and hoping they
 * collide. A timing race would pass on a slow machine for a reason unrelated to the property.
 */
import { chmodSync, mkdtempSync, mkdirSync, statSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeSecureJson, readSecureJson, tempPathFor } from '../../src/hooks/secure-store.js'

let home: string
let store: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theokit-secure-'))
  store = join(home, '.theokit', 'store.json')
  mkdirSync(dirname(store), { recursive: true, mode: 0o700 })
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('writeSecureJson', () => {
  it('every_temp_path_is_distinct', () => {
    const names = new Set(Array.from({ length: 1_000 }, () => tempPathFor(store)))

    expect(names.size, `1000 writes produced ${String(names.size)} distinct temp path(s)`).toBe(
      1_000,
    )
  })

  it('the_temp_lives_beside_the_store', () => {
    // `rename` is atomic only WITHIN a filesystem. A temp in the system temp dir would silently
    // degrade to a copy that a reader can catch halfway — the exact hazard the helper exists to
    // remove.
    expect(dirname(tempPathFor(store))).toBe(dirname(store))
  })

  it('the_store_is_owner_only_and_no_temp_survives', () => {
    writeSecureJson(store, () => '[1]\n')

    expect(statSync(store).mode & 0o777).toBe(0o600)
    expect(
      readdirSync(dirname(store)).filter((e) => e.endsWith('.tmp')),
      'a temp file survived the write',
    ).toEqual([])
  })

  it('a_second_write_replaces_the_first', () => {
    writeSecureJson(store, () => '[1]\n')
    writeSecureJson(store, () => '[2]\n')

    expect(readSecureJson<number[]>(store, (raw) => JSON.parse(raw) as number[], []).value).toEqual(
      [2],
    )
  })
})

/**
 * A store another local user can WRITE is not read as authoritative.
 *
 * `ensureSecureDir` held the directory to owner-only, and the read path then opened the file without
 * looking at its mode. So a `hook-approvals.json` left group- or world-writable — by an older
 * version, by a bad umask, by anyone with write access to it — was believed. That file decides which
 * command lines reach `spawn(cmd, { shell: true })`.
 *
 * Fails CLOSED and reports, rather than throwing: an unreadable store already means "nothing is
 * approved", the caller's turn should not end because of it, and `lastReadError` is how the operator
 * learns their approvals stopped applying. Silence would make a tampered store indistinguishable
 * from an empty one.
 *
 * Found by a consumer's own B-019 test failing while it migrated onto this helper.
 */
describe('readSecureJson — an unsafe file mode', () => {
  it('a_world_writable_store_is_refused_and_reported', () => {
    writeSecureJson(store, () => '[1,2,3]\n')
    chmodSync(store, 0o666)

    const read = readSecureJson<number[]>(store, (raw) => JSON.parse(raw) as number[], [])

    expect(read.value, 'a store any local user can write was believed').toEqual([])
    expect(read.error?.message, 'the refusal was silent').toMatch(/writable|mode/i)
  })

  it('a_group_writable_store_is_refused_too', () => {
    writeSecureJson(store, () => '[1]\n')
    chmodSync(store, 0o660)

    expect(readSecureJson<number[]>(store, (raw) => JSON.parse(raw) as number[], []).value).toEqual(
      [],
    )
  })

  it('an_owner_only_store_is_read_normally', () => {
    // Anti-vacuity floor: refusing every store would satisfy both assertions above.
    writeSecureJson(store, () => '[7]\n')

    expect(readSecureJson<number[]>(store, (raw) => JSON.parse(raw) as number[], []).value).toEqual(
      [7],
    )
  })
})
