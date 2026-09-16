/**
 * #83 — a role in `.claude/agents/` is discovered, and the operator's home root is NOT widened.
 *
 * The defect: `discoverSubagents(cwd, { settingSources: ['project'] })` omitted `compatSources`, so
 * a repository keeping its team in the foreign dialect could be delegated TO by name and could not
 * define its own roles there — one dialect, two answers, depending on which selector asked.
 *
 * Four arms, and the three that are NOT the bug are what make the fourth interpretable:
 *
 *   1  native root, project        positive control — the harness finds anything at all
 *   N  native root, operator home  liveness — the `home` handed in is the one actually read,
 *                                  so a failure elsewhere is about the DIALECT and not the ROOT
 *   2  foreign root, project       the surface #83 is about
 *   3  untrusted project           negative control — the gate still closes both project roots
 *
 * Arm 3 is the one that would rot silently. Passing `compatSources` unconditionally would read an
 * untrusted repository's `.claude/agents/`, and `.claude/` is repository-controlled: a hostile
 * checkout would then steer a child's model, sandbox and tools. The arm fails loudly if the option
 * ever escapes the trust gate.
 *
 * Arm 4 pins the deliberate NON-extension. `~/.claude/agents/` on a machine that also runs Claude
 * Code holds that kit's roles; reading it would hand this product a team nobody declared for it —
 * the effect that forced `skills-on-disk.ts` to scope `presentButUndeclared` to the native root
 * when dogfooding surfaced 39 foreign skills. Written as an assertion rather than a comment so the
 * decision is defended by the suite instead of by memory.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { discoverRoles } from '../../src/delegation/role-discovery.js'
import { tempRoot } from '../helpers/temp-root.js'

let PROJ: string
let HOME: string

const role = (root: string, dialect: string, name: string): void => {
  const dir = join(root, dialect, 'agents')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${name}.md`),
    `---\nname: ${name}\ndescription: fixture for #83\ntools: [read_file]\n---\nBody.\n`,
  )
}

beforeAll(() => {
  const base = tempRoot('role-compat-')
  PROJ = join(base, 'proj')
  HOME = join(base, 'home')
  role(PROJ, '.theokit', 'native-proj')
  role(PROJ, '.claude', 'foreign-proj')
  role(HOME, '.theokit', 'native-home')
  role(HOME, '.claude', 'foreign-home')
})

describe('#83 — the foreign dialect is read on the project root', () => {
  it('test_arm1_positive_control_the_native_project_root_resolves', async () => {
    const found = await discoverRoles({ cwd: PROJ, home: HOME, projectAllowed: true })
    expect(Object.keys(found)).toContain('native-proj')
  })

  it('test_armN_liveness_the_home_root_handed_in_is_the_one_read', async () => {
    // Without this arm, a miss on arm 2 is ambiguous between "the dialect is not read" and "this
    // root is not read at all" — the ambiguity the issue's own arm N was built to remove.
    const found = await discoverRoles({ cwd: PROJ, home: HOME, projectAllowed: true })
    expect(Object.keys(found)).toContain('native-home')
  })

  it('test_arm2_a_role_in_dot_claude_agents_is_discovered', async () => {
    const found = await discoverRoles({ cwd: PROJ, home: HOME, projectAllowed: true })
    expect(Object.keys(found)).toContain('foreign-proj')
  })

  it('test_arm3_negative_control_an_untrusted_project_reads_neither_root', async () => {
    const found = await discoverRoles({ cwd: PROJ, home: HOME, projectAllowed: false })
    expect(Object.keys(found)).not.toContain('foreign-proj')
    expect(Object.keys(found)).not.toContain('native-proj')
  })

  it('test_arm4_the_operators_own_foreign_root_is_deliberately_not_read', async () => {
    const found = await discoverRoles({ cwd: PROJ, home: HOME, projectAllowed: true })
    expect(
      Object.keys(found),
      'a home `.claude/agents/` was imported — on a machine running Claude Code that is its team, not ours',
    ).not.toContain('foreign-home')
  })
})
