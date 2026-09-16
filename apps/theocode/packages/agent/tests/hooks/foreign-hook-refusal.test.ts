/**
 * A hook this product refuses must SAY it refused, before the silence rather than after.
 *
 * `refuseForeignHook` answers the framework's spawn-time question and returns `false`, and the
 * framework then treats the hook as one that was never configured — the operation proceeds, so the
 * refusal produces no observable signal at all. For a hook in a project `.claude/settings.json`
 * there is a second, unrelated path that does reach the operator: `normaliseHooks` pushes a message
 * into `droppedHooks`, which `settingsReport` collects and doctor renders.
 *
 * `<cwd>/.theokit/hooks.json` has no such path. It is not a settings candidate, `parseHooks` never
 * sees it, and it appears in no doctor row. An operator writes a PreToolUse guard there, it never
 * fires, and nothing says why. The module wrote the sentence that would say why and nothing emitted
 * it — `refusalNotice` had no production caller in any package.
 *
 * Reporting at RESOLUTION rather than at spawn is the deliberate part. The spawn-time notice can
 * only arrive after the hook has already failed to run; the files are on disk before the turn
 * starts, so the question "will my hook run?" is answerable up front, with the commands named.
 */
import { describe, expect, it } from 'vitest'

import { diagnose } from '@theokit/agents/doctor'

import { collectChecks } from '../../src/doctor/doctor.js'
import { foreignHookRefusals } from '../../src/hooks/foreign-hook-gate.js'

const files = (contents: Record<string, string>) => ({
  exists: (p: string) => p in contents,
  read: (p: string) => contents[p] ?? '',
})

describe('the foreign hook files an operator is not told about', () => {
  it('test_a_hooks_json_that_declares_a_command_is_reported_with_the_command_named', () => {
    // The finding, as an assertion. "A hook was refused" sends someone reading every settings file
    // in the repository; naming the path ends the search and naming the command ends the doubt.
    const refusals = foreignHookRefusals(
      '/proj',
      files({
        '/proj/.theokit/hooks.json': JSON.stringify({
          PreToolUse: [{ hooks: [{ type: 'command', command: 'guard.sh' }] }],
        }),
      }),
    )
    expect(refusals).toEqual([{ path: '/proj/.theokit/hooks.json', commands: ['guard.sh'] }])
  })

  it('test_a_file_that_is_absent_is_not_reported', () => {
    // Anti-vacuity: a check that reported the path unconditionally would satisfy the case above and
    // put a permanent row in a nine-row diagnostic. This repository's own rule — a row that always
    // reads the same thing is noise, and noise is what makes a diagnostic stop being read.
    expect(foreignHookRefusals('/proj', files({}))).toEqual([])
  })

  it('test_a_file_that_exists_but_declares_no_hook_is_not_reported', () => {
    // The second half of the same floor: present is not the same as consequential. Nothing is
    // refused here, so there is nothing to tell anyone.
    expect(foreignHookRefusals('/proj', files({ '/proj/.theokit/hooks.json': '{}' }))).toEqual([])
  })

  it('test_a_malformed_file_is_reported_without_naming_a_command_it_could_not_read', () => {
    // Fail-clear over fail-silent, and honest about what it knows: the framework will still try to
    // load this file, so the refusal stands, but claiming a command that was never parsed would be
    // fabricating the evidence the message exists to supply.
    const refusals = foreignHookRefusals('/proj', files({ '/proj/.theokit/hooks.json': '{not json' }))
    expect(refusals).toEqual([{ path: '/proj/.theokit/hooks.json', commands: [] }])
  })
})

describe('the wiring', () => {
  // Driven through `collectChecks`, NOT through `foreignHookCheck` directly, and the first version
  // of this file got that wrong. Calling the row builder proves the builder works and says nothing
  // about whether anything calls it — which is the exact defect this review found across four
  // areas, and the one that let two data-losing bugs sit inside an apply phase no test entered.
  // Removing the line in `collectChecks` must turn this red. It does.
  const base = {
    cwd: '/tmp/p',
    trustLevel: 'trusted',
    model: 'openai/gpt-5',
    effort: 'medium',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    credential: 'present' as const,
    wired: {
      mcp: { active: [], suppressedByTrust: false },
      skills: { active: [], suppressedByTrust: false },
      hooks: { active: [], suppressedByTrust: false },
    },
  }
  const REFUSED = [{ path: '/proj/.theokit/hooks.json', commands: ['guard.sh'] }]

  it('test_doctor_renders_a_row_when_a_refused_hook_file_is_present', () => {
    // Pillar (a). A notice nobody emits is the finding itself — `refusalNotice` had no production
    // caller in any package, so the module wrote the sentence explaining the silence and nothing
    // said it. It lands beside `settings`, where the sibling refusal already lands, rather than in
    // a second surface invented for one question.
    const row = collectChecks({ ...base, foreignHooks: REFUSED }).find(
      (c) => c.name === 'hooks-not-run',
    )
    expect(row?.status).toBe('warn')
    expect(row?.detail).toContain('/proj/.theokit/hooks.json')
    expect(row?.detail).toContain('guard.sh')
    expect(row?.detail).toContain('.theocode/settings.json')
  })

  it('test_no_row_is_added_when_nothing_is_refused', () => {
    // Anti-vacuity, and this repository's own stated rule for its diagnostic: a row that permanently
    // reads "none" is noise, and noise is what makes a diagnostic stop being read.
    expect(collectChecks(base).some((c) => c.name === 'hooks-not-run')).toBe(false)
  })

  it('test_it_warns_and_does_not_fail_the_install', () => {
    // Nothing is broken by a hook this product declined to run — the operation it attached to still
    // proceeds by design. Exiting non-zero would report a working install as broken.
    expect(diagnose(collectChecks({ ...base, foreignHooks: REFUSED })).failed).toBe(0)
  })
})
