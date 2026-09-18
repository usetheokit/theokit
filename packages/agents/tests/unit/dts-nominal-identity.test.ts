import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import pkg from '../../package.json' with { type: 'json' }

/**
 * One exported class is DECLARED once across the entries this package publishes.
 *
 * ## The failure, which is not a style question
 *
 * TypeScript compares a class carrying a `private`, `protected` or `#` member NOMINALLY. Two
 * declarations of the same class are incompatible types even when the text is identical. So when two
 * entry points each emit their own copy, a consumer combining them — the documented combination — is
 * rejected with *"types have separate declarations of a private property"*, an error that names a
 * field and says nothing about import sites.
 *
 * Measured on the reference repository (`Workflow`, usetheokit/theokit-sdk#361): `dist/index.d.ts`
 * typed one property against a copy inlined into a shared chunk while `dist/workflow.d.ts` declared
 * its own. `import { Workflow } from '…/workflow'` plus `import { Cron } from '…'` did not typecheck.
 * Nothing in-tree crossed that boundary — in-tree code imports from `src/` — which is why it survived
 * to a release.
 *
 * ## Scope is the EXPORTS MAP, not `dist/`
 *
 * A class appearing twice in files no subpath reaches cannot be held twice by any consumer. A gate
 * over the whole of `dist/` reports findings nobody can trigger, and noise is what trains people to
 * ignore a gate.
 *
 * ## A structural class is exempt, deliberately
 *
 * With no nominal member, two identical declarations are mutually assignable: a duplicate costs bytes
 * rather than correctness. Failing on it would make the gate fire where nothing is wrong.
 *
 * ## What this finds today: nothing
 *
 * Measured 2026-09-18 across the twenty published entries: zero classes declared more than once. This
 * is a regression guard, and it is written down as one so a green run is not read as a repair.
 */

const ROOT = join(import.meta.dirname, '..', '..')

/** `subpath -> emitted declaration`, from the manifest a consumer actually resolves through. */
function publishedDeclarations(): Map<string, string> {
  const exports_ = (pkg as { exports?: Record<string, unknown> }).exports ?? {}
  const out = new Map<string, string>()
  for (const [sub, value] of Object.entries(exports_)) {
    if (!sub.startsWith('.') || sub === './package.json') continue
    const types = typeof value === 'string' ? value : (value as { types?: string }).types
    if (types === undefined) continue
    const abs = join(ROOT, types)
    if (existsSync(abs)) out.set(sub, abs)
  }
  return out
}

interface ClassDecl {
  readonly name: string
  readonly nominal: boolean
}

/** Every class a declaration file declares, and whether it carries a nominal member. */
function classesIn(file: string): ClassDecl[] {
  const text = readFileSync(file, 'utf8')
  const found: ClassDecl[] = []
  for (const m of text.matchAll(/^[\t ]*(?:declare )?(?:abstract )?class (\w+)/gm)) {
    const bodyEnd = text.indexOf('\n}', m.index ?? 0)
    const body = bodyEnd === -1 ? '' : text.slice(m.index ?? 0, bodyEnd)
    found.push({ name: m[1] ?? '', nominal: /^[\t ]*(private|protected|#)/m.test(body) })
  }
  return found
}

const DECLARATIONS = publishedDeclarations()

describe('a published class is declared once across the entries a consumer can import', () => {
  it('test_the_scan_read_the_published_entries_at_all', () => {
    // COUNTERPROOF. An empty map, or a regex that stopped matching the emitted shape, would make the
    // assertion below pass over nothing — the one way this gate can be green and mean nothing.
    expect(DECLARATIONS.size, 'no published declaration files were resolved').toBeGreaterThan(5)
    const total = [...DECLARATIONS.values()].reduce((n, f) => n + classesIn(f).length, 0)
    expect(total, 'the scan found no class in any published declaration').toBeGreaterThan(0)
  })

  it('test_no_NOMINAL_class_is_declared_by_two_published_entries', () => {
    const where = new Map<string, Set<string>>()
    const nominal = new Set<string>()
    for (const [sub, file] of DECLARATIONS) {
      for (const c of classesIn(file)) {
        if (!where.has(c.name)) where.set(c.name, new Set())
        where.get(c.name)?.add(sub)
        if (c.nominal) nominal.add(c.name)
      }
    }
    const clashes = [...where.entries()]
      .filter(([name, subs]) => subs.size > 1 && nominal.has(name))
      .map(
        ([name, subs]) =>
          `${name} declared by ${[...subs].sort((a, b) => a.localeCompare(b)).join(' and ')}`,
      )
      .sort((a, b) => a.localeCompare(b))

    expect(
      clashes,
      `class(es) with a nominal member declared by more than one published entry:\n  ${clashes.join('\n  ')}\n` +
        'A consumer importing both entries gets "types have separate declarations of a private ' +
        'property", naming a field and not the import sites. The fix is one declaration reached by ' +
        'both entries, never a cast at the call site.',
    ).toEqual([])
  })
})
