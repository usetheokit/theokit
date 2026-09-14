import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveOperatorRoots } from '../../src/index.js'

/**
 * B-024 AC-002 — an operator skill reaches a run whose cwd contains none.
 *
 * The unit tests prove the reader. They do not prove the capability, and the capability IS the
 * point: the reason an operator root exists is a repository that carries nothing of its own. A
 * consumer who has to put the skill in every project they clone has no operator root, whatever the
 * flag says.
 *
 * Imported from the package entry rather than a relative path, deliberately — FR-003 measures
 * reachability through the public export map, and a relative import would prove the module works
 * while saying nothing about what a consumer can reach.
 */
function operatorHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'b024-operator-'))
  mkdirSync(join(home, '.theokit', 'skills'), { recursive: true })
  writeFileSync(
    join(home, '.theokit', 'skills', 'deploy.md'),
    '---\nname: deploy\n---\nthe operator wrote this once, for every project\n',
  )
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true })
  writeFileSync(
    join(home, '.claude', 'agents', 'auditor.md'),
    '---\nname: auditor\n---\nfrom another product\n',
  )
  return home
}

describe('an operator root reaches a project that carries none', () => {
  it('test_an_operator_skill_reaches_a_cwd_with_none', () => {
    const home = operatorHome()
    // A project directory with nothing of its own — the case the operator root exists for.
    const project = mkdtempSync(join(tmpdir(), 'b024-bare-project-'))

    const out = resolveOperatorRoots({ user: true, grants: [], homeDir: home })
    const deploy = out.definitions.find((d) => d.name === 'deploy')

    expect(deploy, `the operator's skill did not reach a run whose cwd is ${project}`).toBeDefined()
    expect(deploy?.origin).toBe('theokit')
    expect(
      deploy?.path.startsWith(home),
      'the definition did not come from the operator root',
    ).toBe(true)
  })

  it('test_the_foreign_inventory_needs_the_grant_end_to_end', () => {
    const home = operatorHome()

    const withGrant = resolveOperatorRoots({ user: true, grants: ['claude-code'], homeDir: home })
    const without = resolveOperatorRoots({ user: true, grants: [], homeDir: home })

    expect(withGrant.definitions.map((d) => d.name)).toContain('auditor')
    expect(without.definitions.map((d) => d.name)).not.toContain('auditor')
    // And the loss is NAMED, which is the half a count would destroy.
    expect(without.withheld.map((w) => w.root).join(' ')).toContain('.claude')
  })

  it('test_a_consumer_who_declared_nothing_is_unaffected', () => {
    // NFR-002 end to end: the capability costs nothing to a consumer who never asked for it.
    const home = operatorHome()

    const out = resolveOperatorRoots({ user: false, grants: ['claude-code'], homeDir: home })

    expect(out.definitions).toEqual([])
    expect(out.rootsRead, 'a root was walked for a consumer who asked for none').toEqual([])
  })
})
