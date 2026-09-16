/**
 * #72 — the operator's instructions and rules live in the same directory as the rest of their state.
 *
 * `config.toml` moved to the unified directory; `AGENTS.md` and `rules/` were still pinned to
 * `.theocode/`. Leaving them behind would have been the worse outcome of the two: an operator who
 * puts every file this product reads in one place, and finds two of them ignored with no error, has
 * met the same failure `config.ts` recorded for a `[[hooks]]` block in the wrong directory.
 *
 * The previous location keeps working. It is read, never written.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadUserRules } from '../../src/context/rules.js'
import { loadUserAgentsMd } from '../../src/context/user-agents-md.js'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-unified-home-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function write(rel: string, name: string, body: string): void {
  mkdirSync(join(home, rel), { recursive: true })
  writeFileSync(join(home, rel, name), body)
}

const silent = (): void => {}

/**
 * B-172 — `$THEOKIT_HOME` is isolated because `userAgentsMdPath` HONOURS it, correctly: it resolves
 * through `homeStateDir(env, home)` like config, the trust store and MCP scopes do. So an operator
 * who exports it sends this test's loader looking somewhere other than the `home` the test built,
 * and the failure is the test reaching into the environment — not the product ignoring it.
 *
 * Worth the comment because the opposite was recorded first: three failures under an exported
 * `$THEOKIT_HOME` were registered as a product defect (B-172) without opening this file, which is
 * the same inference that put a documented skills boundary through a whole implement-and-revert
 * cycle earlier the same day.
 */
const realStateDir = process.env.THEOKIT_HOME

beforeEach(() => {
  delete process.env.THEOKIT_HOME
})

afterEach(() => {
  if (realStateDir === undefined) delete process.env.THEOKIT_HOME
  else process.env.THEOKIT_HOME = realStateDir
})


describe('#72 — user AGENTS.md in the unified directory', () => {
  it('test_the_unified_location_is_read', () => {
    write('.theokit', 'AGENTS.md', 'unified instruction\n')

    expect(loadUserAgentsMd(home, silent)).toContain('unified instruction')
  })

  it('test_the_previous_location_still_works', () => {
    write('.theocode', 'AGENTS.md', 'legacy instruction\n')

    expect(loadUserAgentsMd(home, silent)).toContain('legacy instruction')
  })

  it('test_the_unified_location_wins_when_both_exist', () => {
    write('.theokit', 'AGENTS.md', 'unified instruction\n')
    write('.theocode', 'AGENTS.md', 'legacy instruction\n')

    const text = loadUserAgentsMd(home, silent)
    expect(text).toContain('unified instruction')
    expect(text).not.toContain('legacy instruction')
  })

  it('test_an_import_resolves_against_the_directory_the_file_came_from', () => {
    // The confinement root travels with the file. Resolving a legacy file's import against the
    // unified directory would make `@shared.md` unreadable from the very place it sits.
    write('.theocode', 'AGENTS.md', 'see @shared.md\n')
    write('.theocode', 'shared.md', 'shared body\n')

    expect(loadUserAgentsMd(home, silent)).toContain('shared body')
  })

  it('test_no_file_anywhere_is_empty_not_an_error', () => {
    expect(loadUserAgentsMd(home, silent)).toBe('')
  })
})

describe('#72 — user rules in the unified directory', () => {
  it('test_the_unified_location_is_read', () => {
    write(join('.theokit', 'rules'), 'style.md', '# Style\nbody\n')

    expect(loadUserRules(home, silent).count).toBe(1)
  })

  it('test_both_locations_are_read_because_a_rule_is_additive', () => {
    // Rules differ from AGENTS.md on purpose. AGENTS.md is ONE document under three possible names,
    // so first-wins is right; a rules directory is a set, and dropping one because another directory
    // also has rules would silently disable it.
    write(join('.theokit', 'rules'), 'a.md', '# A\nbody\n')
    write(join('.theocode', 'rules'), 'b.md', '# B\nbody\n')

    expect(loadUserRules(home, silent).count).toBe(2)
  })
})
