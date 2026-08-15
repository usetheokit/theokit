/**
 * T3.3 — persisted tool-permission grants.
 *
 * The only GENUINE absorption in this plan: verified by grep, neither the framework nor its consumer
 * has this for tools. `ApprovalDecision` settles one request; nothing persists a standing grant. So
 * a user approves the same `npm test` a tenth time, or turns on `full-auto` — which removes the gate
 * entirely. "Always allow this" is the first thing anyone asks for after the tenth prompt, and the
 * only two answers on offer were "no" and "allow everything".
 *
 * The grant KEY is the whole safety property. Keyed on tool name alone, "always allow run_shell"
 * would approve every command ever written. Keyed on (tool, scope, signature), a grant for
 * `npm test` in `/repo/a` authorises nothing in `/repo/b` and nothing that is not `npm test`.
 */
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PermissionStore } from '../../src/auth/permission-store.js'

let home: string
let repoA: string
let repoB: string

function storeAt(now?: () => number): PermissionStore {
  return new PermissionStore({ home, ...(now ? { now } : {}) })
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theokit-perms-'))
  repoA = mkdtempSync(join(tmpdir(), 'repo-a-'))
  repoB = mkdtempSync(join(tmpdir(), 'repo-b-'))
})

afterEach(() => {
  for (const dir of [home, repoA, repoB]) rmSync(dir, { recursive: true, force: true })
})

describe('PermissionStore', () => {
  it('absent_grant_denies', () => {
    expect(storeAt().isGranted({ tool: 'run_shell', scope: repoA, command: 'npm test' })).toBe(
      false,
    )
  })

  it('granted_command_is_allowed', () => {
    const store = storeAt()
    store.grant({ tool: 'run_shell', scope: repoA, command: 'npm test' })

    expect(store.isGranted({ tool: 'run_shell', scope: repoA, command: 'npm test' })).toBe(true)
    // Round-trips through disk — a grant that dies with the process is not a grant.
    expect(storeAt().isGranted({ tool: 'run_shell', scope: repoA, command: 'npm test' })).toBe(true)
  })

  it('grant_is_scoped', () => {
    const store = storeAt()
    store.grant({ tool: 'run_shell', scope: repoA, command: 'npm test' })

    expect(store.isGranted({ tool: 'run_shell', scope: repoB, command: 'npm test' })).toBe(false)
  })

  it('grant_is_signature_specific', () => {
    const store = storeAt()
    store.grant({ tool: 'run_shell', scope: repoA, command: 'npm test' })

    expect(store.isGranted({ tool: 'run_shell', scope: repoA, command: 'npm publish' })).toBe(false)
    // Near-match must NOT pass. A fuzzy grant is worse than no grant.
    expect(store.isGranted({ tool: 'run_shell', scope: repoA, command: 'npm test --force' })).toBe(
      false,
    )
  })

  it('grant_is_tool_specific', () => {
    const store = storeAt()
    store.grant({ tool: 'run_shell', scope: repoA, command: 'npm test' })

    expect(store.isGranted({ tool: 'apply_patch', scope: repoA, command: 'npm test' })).toBe(false)
  })

  it('scope_is_canonicalized', () => {
    // EC-2 (MUST FIX) — `/repo/a`, `/repo/a/` and `/repo/./a` are ONE directory and three strings.
    // Raw equality denies grants the user made, which trains them to reach for full-auto.
    const store = storeAt()
    store.grant({ tool: 'run_shell', scope: repoA, command: 'npm test' })

    for (const variant of [`${repoA}/`, join(repoA, '.'), join(repoA, 'sub', '..')]) {
      expect(
        store.isGranted({ tool: 'run_shell', scope: variant, command: 'npm test' }),
        `variant ${variant} did not match the grant`,
      ).toBe(true)
    }
  })

  it('a_symlink_resolves_to_its_target_scope', () => {
    // The dangerous half of EC-2, and the reason `realpath` and not string normalisation: a link
    // pointing at the granted directory must resolve to it, and a link pointing ELSEWHERE must not
    // borrow its grant. The consumer's own TrustStore had this defect measured.
    const store = storeAt()
    store.grant({ tool: 'run_shell', scope: repoA, command: 'npm test' })

    const linkToA = join(home, 'link-a')
    const linkToB = join(home, 'link-b')
    symlinkSync(repoA, linkToA)
    symlinkSync(repoB, linkToB)

    expect(store.isGranted({ tool: 'run_shell', scope: linkToA, command: 'npm test' })).toBe(true)
    expect(store.isGranted({ tool: 'run_shell', scope: linkToB, command: 'npm test' })).toBe(false)
  })

  it('unresolvable_scope_is_refused', () => {
    // Never key on the raw string as a fallback: that would silently reintroduce the string
    // comparison this whole test exists to remove.
    const store = storeAt()
    const missing = join(repoA, 'does', 'not', 'exist')

    expect(() => store.grant({ tool: 'run_shell', scope: missing, command: 'npm test' })).toThrow(
      /scope/i,
    )
    expect(store.isGranted({ tool: 'run_shell', scope: missing, command: 'npm test' })).toBe(false)
  })

  it('expired_grant_denies_and_is_reported', () => {
    let clock = 1_000
    const store = storeAt(() => clock)
    store.grant({ tool: 'run_shell', scope: repoA, command: 'npm test' }, { ttlMs: 500 })

    clock = 1_400
    expect(store.isGranted({ tool: 'run_shell', scope: repoA, command: 'npm test' })).toBe(true)

    clock = 1_500
    // EC-14 — the boundary itself: expiring exactly at `now` denies. Pinned so a later refactor to
    // `<` is caught.
    expect(store.isGranted({ tool: 'run_shell', scope: repoA, command: 'npm test' })).toBe(false)
    expect(store.expired().map((g) => g.command)).toContain('npm test')
  })

  it('a_grant_without_ttl_does_not_expire', () => {
    let clock = 1_000
    const store = storeAt(() => clock)
    store.grant({ tool: 'run_shell', scope: repoA, command: 'npm test' })

    clock = Number.MAX_SAFE_INTEGER
    expect(store.isGranted({ tool: 'run_shell', scope: repoA, command: 'npm test' })).toBe(true)
  })

  it('revoking_denies_again', () => {
    const store = storeAt()
    store.grant({ tool: 'run_shell', scope: repoA, command: 'npm test' })
    store.revoke({ tool: 'run_shell', scope: repoA, command: 'npm test' })

    expect(store.isGranted({ tool: 'run_shell', scope: repoA, command: 'npm test' })).toBe(false)
  })

  it('corrupt_store_denies_and_reports', () => {
    const store = storeAt()
    store.grant({ tool: 'run_shell', scope: repoA, command: 'npm test' })
    mkdirSync(join(home, '.theokit'), { recursive: true })

    writeFileSync(store.path, '{ not json', 'utf8')

    const fresh = storeAt()
    expect(fresh.isGranted({ tool: 'run_shell', scope: repoA, command: 'npm test' })).toBe(false)
    expect(fresh.lastReadError, 'a corrupt grant store must be reported').toBeDefined()
  })

  it('concurrent_grants_do_not_tear_the_file', async () => {
    // Atomic-counter invariant (concurrent test) — N writers, and ALL N must survive.
    //
    // This asserted `> 0` at first, hedging against a lost update. Measured: all twelve survive, and
    // deterministically, because `grant()` is synchronous end to end — load, modify, write, rename —
    // so twelve "concurrent" callers serialise on the event loop and none observes another's
    // half-written state. `> 0` was weaker than the property that actually holds, and a weak
    // assertion on a store that decides what may execute is a regression that ships quietly.
    //
    // What this really guards is that guarantee's PRECONDITION. Make any part of the
    // read-modify-write path async without adding a lock and the interleaving becomes real: two
    // callers read the same array, both append, and the second rename discards the first grant — a
    // permission the operator believes they still have. This assertion turns that change from
    // silent into red.
    await Promise.all(
      Array.from({ length: 12 }, async (_, i) =>
        storeAt().grant({ tool: 'run_shell', scope: repoA, command: `npm run task-${String(i)}` }),
      ),
    )

    const fresh = storeAt()
    expect(fresh.lastReadError, 'the store did not parse after concurrent writes').toBeUndefined()
    expect(fresh.list().length, 'a concurrent grant was lost').toBe(12)
  })
})
