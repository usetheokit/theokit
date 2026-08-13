import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  TrustStore,
  TrustStorePermissionsError,
} from '../../packages/theo/src/config/trust-store.js'

/**
 * M73 — the per-directory trust store, against a real file on disk.
 *
 * Real files, not mocks: every assertion here is about bytes and permission bits, and a mocked
 * filesystem would let all of them pass while the store wrote a world-writable file.
 *
 * ## Why persisting matters
 *
 * M68 made the `project` setting source require a `TrustPosture` — evidence rather than a claim. A
 * posture recomputed every run is a question asked over and over, and a question asked every run is
 * one users learn to answer without reading. Persisting turns the stamp into a DECISION: recorded
 * once, auditable after, answerable by "who trusted this, when, on what basis".
 */

const DECISION = {
  path: '/repo/some-project',
  decidedAt: '2026-08-13T12:00:00.000Z',
  decidedBy: 'paulo',
  trusted: true,
}

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theokit-trust-'))
  file = join(dir, 'trust.json')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('TrustStore — a decision that survives the process', () => {
  it('test_a_missing_store_is_an_empty_one_not_an_error', () => {
    // A machine that has trusted nothing yet is the correct starting state, and the safe one.
    expect(new TrustStore(file).read()).toEqual([])
  })

  it('test_a_recorded_decision_round_trips_with_its_provenance', async () => {
    // The audit question the milestone asks for: who, when, and on what basis — not just a boolean.
    const store = new TrustStore(file)
    await store.trust(DECISION)
    expect(store.read()).toEqual([DECISION])
  })

  it('test_re_deciding_REPLACES_rather_than_appending', async () => {
    // Two records for one path would make "is this trusted?" depend on which one a reader hits
    // first, and the answer would silently depend on write order.
    const store = new TrustStore(file)
    await store.trust(DECISION)
    await store.trust({ ...DECISION, trusted: false, decidedAt: '2026-08-14T00:00:00.000Z' })
    const records = store.read()
    expect(records).toHaveLength(1)
    expect(records[0].trusted).toBe(false)
  })

  it('test_the_clock_and_the_identity_are_the_CALLERS', async () => {
    // Injected rather than derived (DIP). A `new Date()` baked in would make every assertion about
    // the record depend on when the test ran, and the identity is not something a library can know.
    const store = new TrustStore(file)
    await store.trust({
      ...DECISION,
      decidedAt: '1999-01-01T00:00:00.000Z',
      decidedBy: 'ci-job-42',
    })
    expect(store.read()[0]).toMatchObject({
      decidedAt: '1999-01-01T00:00:00.000Z',
      decidedBy: 'ci-job-42',
    })
  })
})

describe('postureFor — the M68 TrustDecision, now persisted', () => {
  it('test_a_trusted_directory_grants_the_capability', async () => {
    const store = new TrustStore(file)
    await store.trust(DECISION)
    expect(store.postureFor(DECISION.path, ['projectSettings']).allows.projectSettings).toBe(true)
  })

  it('test_an_UNRECORDED_directory_resolves_to_untrusted', () => {
    // Absence resolves to untrusted, never to "unknown, proceed". A store that answered "I do not
    // know" would hand the decision back to the caller — and the caller asking is the whole reason
    // the store exists.
    const store = new TrustStore(file)
    expect(store.postureFor('/never/seen', ['projectSettings']).allows.projectSettings).toBe(false)
  })

  it('test_a_decision_recorded_as_NOT_trusted_denies', async () => {
    // Counter-proof that the store reads the flag rather than merely the presence of a record.
    const store = new TrustStore(file)
    await store.trust({ ...DECISION, trusted: false })
    expect(store.postureFor(DECISION.path, ['projectSettings']).allows.projectSettings).toBe(false)
  })
})

describe('file permissions — checked on READ, and refused rather than repaired', () => {
  it('test_the_store_is_created_owner_only', async () => {
    await new TrustStore(file).trust(DECISION)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it.each([
    ['group-writable', 0o620],
    ['world-writable', 0o606],
  ])('test_a_%s_store_is_REFUSED_on_read', (_label, mode) => {
    // This file decides which directories may run shell hooks. A store another user can write is a
    // way for them to grant themselves that. Checking only at write time would leave a file whose
    // mode was loosened AFTERWARDS looking fine — so the check is where the value is consumed.
    writeFileSync(file, JSON.stringify({ version: 1, records: [DECISION] }), 'utf8')
    chmodSync(file, mode)
    expect(() => new TrustStore(file).read()).toThrow(TrustStorePermissionsError)
  })

  it('test_the_refusal_names_the_file_the_mode_and_the_fix', () => {
    // A security refusal that does not say what to do gets worked around rather than fixed.
    writeFileSync(file, JSON.stringify({ version: 1, records: [] }), 'utf8')
    chmodSync(file, 0o666)
    try {
      new TrustStore(file).read()
      expect.unreachable('a world-writable trust store was accepted')
    } catch (error) {
      expect(error).toBeInstanceOf(TrustStorePermissionsError)
      const message = (error as Error).message
      expect(message).toContain(file)
      expect(message).toMatch(/666/)
      expect(message).toMatch(/chmod 600/)
    }
  })

  it('test_a_read_only_store_is_ACCEPTED', () => {
    // Counter-proof: the check is about WRITE bits. Refusing 0o400 would reject a correctly
    // hardened store, and a guard that rejects the safest configuration teaches people to loosen it.
    writeFileSync(file, JSON.stringify({ version: 1, records: [DECISION] }), 'utf8')
    chmodSync(file, 0o400)
    expect(new TrustStore(file).read()).toEqual([DECISION])
  })
})
