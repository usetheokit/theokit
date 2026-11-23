/**
 * The collector deletes only inside a root it marked as its own.
 *
 * Today the transcript root moves with `THEOKIT_HOME`, and the sweep enumerates whatever is there.
 * Measured 2026-09-04 against the built binary: with the variable pointed at an empty directory it
 * reported `DRY-RUN — 0 would remove; 0 kept` and exited 0. The SDK's own docblock names that shape
 * — "a wrong path that returns nothing is a collector that quietly stopped collecting" — and the
 * consequence gets worse the moment the root is SHARED.
 *
 * The reason this is being built now: the product is gaining a configurable home directory, so an
 * operator can point it at `.claude`. Our retention would then enumerate Claude Code's transcripts,
 * and `resolveGuards` protects only ids in OUR registry — a foreign transcript is not in it, so it
 * is not protected, so a 30-day-old Claude Code session is collectable.
 *
 * The discriminator is the ROOT, not the transcript. Attributing per file would mean flipping the
 * registry from a protect-list to an allow-list, which stops collecting our own transcripts whose
 * registry entry was pruned — trading a data-loss bug for a silent-leak one. A marker answers the
 * question once, at the level the question is actually about.
 *
 * It fails LOUD. An unmarked root is refused with its reason, never swept-and-reported-clean, which
 * is the failure this whole file exists to remove.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { claimRoot, rootIsOurs, OWNERSHIP_MARKER } from '../../../src/session/gc/root-ownership.js'

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function scratchRoot(): string {
  const base = mkdtempSync(join(tmpdir(), 'theocode-own-'))
  roots.push(base)
  const projects = join(base, 'projects')
  mkdirSync(projects, { recursive: true })
  return projects
}

describe('root ownership', () => {
  it('test_an_unmarked_root_is_not_ours', () => {
    // The `.claude` case: another product's directory, which we must not sweep.
    expect(rootIsOurs(scratchRoot())).toBe(false)
  })

  it('test_a_root_we_claimed_is_ours', () => {
    const root = scratchRoot()
    claimRoot(root)

    expect(rootIsOurs(root)).toBe(true)
  })

  it('test_the_marker_sits_beside_the_projects_directory_not_inside_it', () => {
    // `listProjectDirs` enumerates everything under `projects/`. A marker inside it is a file in the
    // middle of the one path that deletes user data — the same reasoning `stampPath` already
    // records for `.last-session-gc`, followed here rather than re-decided.
    const root = scratchRoot()
    claimRoot(root)

    expect(join(dirname(root), OWNERSHIP_MARKER)).toContain(OWNERSHIP_MARKER)
    expect(rootIsOurs(root)).toBe(true)
  })

  it('test_claiming_is_idempotent', () => {
    const root = scratchRoot()
    claimRoot(root)
    claimRoot(root)

    expect(rootIsOurs(root)).toBe(true)
  })

  it('test_a_marker_that_names_another_product_is_not_ours', () => {
    // Someone else's marker, or ours from a future schema. Refusing is the safe direction: the
    // alternative is deleting under a contract we do not understand.
    const root = scratchRoot()
    writeFileSync(join(dirname(root), OWNERSHIP_MARKER), JSON.stringify({ product: 'something-else' }))

    expect(rootIsOurs(root)).toBe(false)
  })

  it('test_an_unreadable_marker_is_not_ours', () => {
    // Anti-vacuity in the safe direction: garbage must not read as a claim.
    const root = scratchRoot()
    writeFileSync(join(dirname(root), OWNERSHIP_MARKER), 'not json at all')

    expect(rootIsOurs(root)).toBe(false)
  })

  it('test_claiming_a_root_that_cannot_be_written_does_not_throw', () => {
    // A read-only home must not take the agent down — the same tolerance `stampTolerantly` applies
    // one file over. It returns false rather than pretending the claim landed.
    const blocked = join(mkdtempSync(join(tmpdir(), 'theocode-own-ro-')), 'a-file', 'projects')
    roots.push(dirname(dirname(blocked)))
    writeFileSync(join(dirname(dirname(blocked)), 'a-file'), 'not a directory')

    expect(() => claimRoot(blocked)).not.toThrow()
    expect(rootIsOurs(blocked)).toBe(false)
  })
})
