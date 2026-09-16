/**
 * B-033 — the injected-environment seam reaches the exported entry point.
 *
 * B-006 added an `env` parameter so a caller that resolves configuration from an explicit
 * environment gets a trust decision from THAT environment. It was added to the PRIVATE
 * `trustOrigin`; the only exported entry, `resolveTrustPosture`, called it with two arguments and
 * never forwarded one. So all nine production call sites read the ambient environment, and the seam
 * the item was closed on could not be reached from outside the module.
 *
 * The disagreement was reachable: `cli/run-composition.ts` took the posture from the ambient
 * environment on one line and passed `seams.env` into config resolution on the next — one run, two
 * sources, for the decision that governs whether a repository's hooks and AGENTS.md are honoured.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { canonical } from '../../src/config/trust-store.js'

import { TRUST_CAPABILITIES, resolveTrustPosture } from '../../src/config/trust-posture.js'

let dir: string
let store: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theocode-posture-'))
  store = join(dir, 'trusted-dirs.json')
  writeFileSync(store, JSON.stringify({ trusted: [] }), { mode: 0o600 })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('B-033 — the trust posture comes from the environment it was given', () => {
  it('test_an_untrusted_directory_is_untrusted_with_an_empty_environment', () => {
    // Anti-vacuity floor: answering "trusted" always would satisfy the assertion below.
    expect(resolveTrustPosture(dir, store, {}).level).toBe('untrusted')
  })

  it('test_the_injected_environment_decides_the_posture', () => {
    const posture = resolveTrustPosture(dir, store, { THEOCODE_TRUST_ALL_DIRS: '1' })

    expect(
      posture.source,
      'the injected environment did not reach the exported entry, so the posture came from the ' +
        'ambient one — the B-006 bullet this item reopened',
    ).toBe('env')
    expect(posture.level).toBe('trusted')
  })

  it('test_two_different_injected_environments_give_two_different_answers', () => {
    // The property that makes the seam worth having: the injected environment is the WHOLE answer,
    // for the same directory and the same store.
    //
    // A first version proved this by SETTING `process.env.THEOCODE_TRUST_ALL_DIRS` and asserting it
    // was ignored. That made the suite flaky: vitest runs files concurrently in one process, and
    // `chat-cwd.test.ts` reads the ambient environment through this same function. It passed alone
    // and failed in the full run. A test that can only be right when it runs alone is a bug
    // (`rules/testing.md` — no shared mutable state), so it was rewritten rather than retried.
    const off = resolveTrustPosture(dir, store, {})
    const on = resolveTrustPosture(dir, store, { THEOCODE_TRUST_ALL_DIRS: '1' })

    expect(off.level).toBe('untrusted')
    expect(on.level).toBe('trusted')
  })
})

/**
 * What the posture is FOR. Every case above reads `level` and `source`; none reads `allows`, so
 * making the gate hand out every capability regardless of trust left the whole suite green. That is
 * the mutation that matters here — it is the difference between a hostile repository's hooks running
 * and not running, and nothing was watching it.
 */
describe('the posture actually gates the capabilities', () => {
  it('test_an_untrusted_directory_allows_no_capability', () => {
    const { allows } = resolveTrustPosture(dir, store, {})

    expect(
      Object.entries(allows).filter(([, granted]) => granted),
      'an untrusted directory granted capabilities — hooks, MCP servers or project instructions ' +
        'would be honoured in a repository the operator never trusted',
    ).toEqual([])
  })

  it('test_a_trusted_directory_allows_every_capability', () => {
    // Anti-vacuity: a gate that denied everything unconditionally would pass the case above.
    const { allows } = resolveTrustPosture(dir, store, { THEOCODE_TRUST_ALL_DIRS: '1' })

    expect(Object.entries(allows).filter(([, granted]) => !granted)).toEqual([])
  })

  it('test_every_declared_capability_is_gated', () => {
    // The invariant that makes forgetting impossible. `TRUST_CAPABILITIES` is the list the doctor
    // and the consent surface enumerate; a capability added there but missing from `allows` reads as
    // `undefined` at the call site and is treated as denied by accident rather than by decision —
    // and the reverse, a key in `allows` nobody declared, is a gate nobody documents.
    const { allows } = resolveTrustPosture(dir, store, {})

    expect(Object.keys(allows).sort()).toEqual([...TRUST_CAPABILITIES.map((c) => c.key)].sort())
  })

  it('test_a_directory_the_operator_recorded_is_trusted_from_the_store', () => {
    // The normal way trust is granted — the operator answers the consent prompt — and it was
    // untested here: replacing the store lookup with a constant `false` left every case green while
    // every trusted directory in the world silently became untrusted.
    writeFileSync(store, JSON.stringify({ trusted: [canonical(dir)] }), { mode: 0o600 })

    const posture = resolveTrustPosture(dir, store, {})

    expect(posture.level).toBe('trusted')
    expect(posture.source, 'trust came from somewhere other than the store').toBe('store')
    expect(Object.values(posture.allows).every(Boolean)).toBe(true)
  })

  it('test_the_environment_outranks_the_store_and_says_which_one_answered', () => {
    // Two facts a surface must be able to tell apart: a directory the operator recorded, and a
    // blanket switch that stays on for every directory the process ever opens. Only the second is
    // worth warning about.
    writeFileSync(store, JSON.stringify({ trusted: [canonical(dir)] }), { mode: 0o600 })

    expect(resolveTrustPosture(dir, store, { THEOCODE_TRUST_ALL_DIRS: '1' }).source).toBe('env')
  })

  it('test_the_deprecated_alias_still_grants_trust', () => {
    // It is deprecated, not removed. If it silently stopped working, an operator who set it would
    // believe every directory was trusted while none was — a surprise in the safe direction, but a
    // surprise, and the deprecation warning promises the opposite.
    const posture = resolveTrustPosture(dir, store, { THEOKIT_TRUST_ALL_DIRS: '1' })

    expect(posture.level).toBe('trusted')
    expect(posture.source).toBe('env')
  })
})
