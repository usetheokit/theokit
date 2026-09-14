import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveOperatorRoots } from '../../src/config/operator-roots.js'

/**
 * B-024 — `user: true` reaches the operator's roots, or refuses. It must never be a silent no-op.
 *
 * The defect: `SettingSourcesSelection.user` is forwarded and consulted by nothing. A consumer sets
 * it, sees no change, and cannot tell "not read here" from "read and my value was wrong" — the
 * accepted-and-ignored failure `rules/foreign-config-surfaces.md` exists to remove.
 *
 * Paulo's decisions, 2026-09-14, recorded in the alignment brief and quoted beside each tick:
 * read the roots in THIS layer (CHK002), and read `~/.claude/skills/` and `agents/` too (CHK003,
 * CHK005) — under the SAME `claude-code` grant, never a looser one.
 */
const made: string[] = []
function home(): string {
  const d = mkdtempSync(join(tmpdir(), 'b024-home-'))
  made.push(d)
  return d
}
function skill(root: string, dir: string, name: string): void {
  mkdirSync(join(root, dir, 'skills'), { recursive: true })
  writeFileSync(join(root, dir, 'skills', `${name}.md`), `---\nname: ${name}\n---\nbody\n`)
}
afterEach(() => {
  for (const d of made.splice(0)) {
    try {
      chmodSync(d, 0o755)
    } catch {
      /* best effort */
    }
  }
})

describe('the user root is honoured or refused', () => {
  it('test_user_true_reads_the_operator_root', () => {
    const h = home()
    skill(h, '.theokit', 'deploy')

    const out = resolveOperatorRoots({ user: true, grants: [], homeDir: h })

    expect(out.definitions.map((d) => d.name)).toContain('deploy')
  })

  it('test_user_absent_reads_nothing', () => {
    // NFR-002: 0 added filesystem reads when the flag is absent. Asserted on the reported read
    // count, not on the result — an empty result is also what a read-everything-then-filter
    // implementation produces, and that one costs a walk on every run.
    const h = home()
    skill(h, '.theokit', 'deploy')

    const out = resolveOperatorRoots({ user: false, grants: [], homeDir: h })

    expect(out.definitions).toEqual([])
    expect(out.rootsRead, 'a root was walked for a consumer who asked for none').toEqual([])
  })

  it('test_the_foreign_root_needs_its_grant', () => {
    const h = home()
    skill(h, '.claude', 'review')

    const granted = resolveOperatorRoots({ user: true, grants: ['claude-code'], homeDir: h })
    const ungranted = resolveOperatorRoots({ user: true, grants: [], homeDir: h })

    expect(granted.definitions.map((d) => d.name)).toContain('review')
    expect(ungranted.definitions.map((d) => d.name)).not.toContain('review')
  })

  it('test_a_withheld_foreign_root_is_named_not_counted', () => {
    // The silent-loss failure this whole line of work removes: an operator who is told "1 root
    // withheld" knows they lost something and not what, which helps nobody.
    const h = home()
    skill(h, '.claude', 'review')

    const out = resolveOperatorRoots({ user: true, grants: [], homeDir: h })

    expect(out.withheld.map((w) => w.root)).toContain(join(h, '.claude', 'skills'))
    expect(out.withheld[0]?.reason).toMatch(/claude-code/)
  })

  it('test_every_definition_carries_its_origin', () => {
    // FR-007: attributable AT THE POINT OF USE. An operator must be able to tell a definition they
    // wrote for this product from one they wrote for another.
    const h = home()
    skill(h, '.theokit', 'ours')
    skill(h, '.claude', 'theirs')

    const out = resolveOperatorRoots({ user: true, grants: ['claude-code'], homeDir: h })
    const byName = new Map(out.definitions.map((d) => [d.name, d.origin]))

    expect(byName.get('ours')).toBe('theokit')
    expect(byName.get('theirs')).toBe('claude-code')
    expect([...byName.values()].every((o) => o !== undefined)).toBe(true)
  })

  it('test_a_missing_root_is_not_an_error', () => {
    const h = home() // nothing created under it

    const out = resolveOperatorRoots({ user: true, grants: ['claude-code'], homeDir: h })

    expect(out.definitions).toEqual([])
    expect(out.withheld).toEqual([])
  })

  it('test_an_unreadable_root_raises_a_typed_error', () => {
    const h = home()
    skill(h, '.theokit', 'deploy')
    chmodSync(join(h, '.theokit', 'skills'), 0o000)

    // Root often bypasses mode bits; skip rather than assert a permission the OS ignores.
    let readable = true
    try {
      resolveOperatorRoots({ user: true, grants: [], homeDir: h })
    } catch {
      readable = false
    }
    if (readable) return

    expect(() => resolveOperatorRoots({ user: true, grants: [], homeDir: h })).toThrow(
      /operator root/i,
    )
  })

  it('test_a_definition_without_frontmatter_is_reported_not_counted', () => {
    const h = home()
    mkdirSync(join(h, '.theokit', 'skills'), { recursive: true })
    writeFileSync(join(h, '.theokit', 'skills', 'broken.md'), 'no frontmatter here\n')

    const out = resolveOperatorRoots({ user: true, grants: [], homeDir: h })

    expect(out.definitions.map((d) => d.name)).not.toContain('broken')
    expect(out.skipped.map((s) => s.path)).toContain(join(h, '.theokit', 'skills', 'broken.md'))
  })
})

/**
 * The public entry, loaded ONCE at module scope — loading it inside a test body charges ~1s of
 * barrel evaluation to that test, measured on B-002.
 */
const publicEntry = (await import('../../src/config-entry.js')) as Record<string, unknown>

describe('the capability is reachable, and the docblock no longer describes a gap', () => {
  it('test_reachable_from_the_public_entry_point', () => {
    // FR-003 measures reachability through the package's export map. A relative import would prove
    // the module works and say nothing about what a consumer can reach — the failure this package's
    // own README records as having cost a downstream product ~120 reimplemented lines.
    expect(typeof publicEntry.resolveOperatorRoots).toBe('function')
    expect(publicEntry.OperatorRootUnreadableError).toBeTypeOf('function')
  })

  it('test_the_field_docblock_no_longer_denies_the_capability', () => {
    // AC-005. The field's docblock said "Nothing reads the operator's root because of this flag".
    // Shipping the read while leaving that sentence would make the file lie in the other direction.
    const src = readFileSync(
      join(import.meta.dirname, '..', '..', 'src', 'bridge', 'setting-sources-gate.ts'),
      'utf8',
    )

    expect(src).not.toContain("Nothing reads the operator's root because of this flag")
    expect(src, 'the docblock does not point at what now does the reading').toContain(
      'resolveOperatorRoots',
    )
  })
})
