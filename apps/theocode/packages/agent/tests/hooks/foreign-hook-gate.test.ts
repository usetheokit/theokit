/**
 * #130 — the gate the framework consults before spawning a hook IT loaded.
 *
 * The behaviour that matters is measured on the built binary, not here: a foreign hook must stop
 * firing AND this product's own approved hooks must keep firing. A gate that refused everything
 * would close the gap and silently disable a working feature, and only the second arm tells those
 * apart. These tests hold the two properties a unit test can hold — the predicate's answer, and
 * that the notice names the file — so a refactor cannot quietly turn the refusal into an approval.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { refusalNotice, refuseForeignHook } from '../../src/hooks/foreign-hook-gate.js'

const request = (over = {}) => ({
  command: '/repo/mark.sh',
  event: 'preToolUse',
  sourcePath: '/repo/.claude/settings.json',
  ...over,
})

describe('#130 — hooks the framework loaded itself', () => {
  it('test_a_hook_this_product_did_not_translate_is_refused', () => {
    expect(refuseForeignHook(request())).toBe(false)
  })

  it('test_the_answer_does_not_depend_on_the_file_it_came_from', () => {
    // Deliberately not a path predicate. Everything reaching this gate came through the framework's
    // own loader, which is the definition of "not fingerprinted here" — including
    // `.theokit/hooks.json`, a file this product never refused because it never read it.
    expect(refuseForeignHook(request({ sourcePath: '/repo/.theokit/hooks.json' }))).toBe(false)
    expect(refuseForeignHook(request({ sourcePath: undefined }))).toBe(false)
  })

  it('test_it_is_a_predicate_and_not_a_deny', () => {
    // The framework treats a refused hook as one that was never configured; the operation it
    // attached to still proceeds. Returning `false` rather than throwing is what carries that — a
    // throw here would stop the work, which is the opposite of what was asked for.
    expect(() => refuseForeignHook(request({ event: 'preRun' }))).not.toThrow()
  })
})

describe('what the operator is told', () => {
  it('test_the_notice_names_the_file_and_where_hooks_do_run', () => {
    // "A hook was refused" sends someone reading every settings file in the repository.
    const notice = refusalNotice({ path: '/repo/.theokit/hooks.json', commands: ['guard.sh'] })
    expect(notice).toContain('/repo/.theokit/hooks.json')
    expect(notice).toContain('guard.sh')
    expect(notice).toContain('.theocode/settings.json')
  })

  it('test_it_says_something_useful_when_no_command_could_be_read', () => {
    // The shape moved from the framework's spawn-time request to the file on disk, and this case
    // moved with it: `sourcePath` was optional there, and here the unknown is the COMMAND — a file
    // the framework will still load but that this product could not parse. A notice reading
    // "undefined will NOT run" is worse than one that admits what it does not know.
    const notice = refusalNotice({ path: '/repo/.theokit/hooks.json', commands: [] })
    expect(notice).not.toContain('undefined')
    expect(notice).toContain('the hooks it declares')
  })
})

describe('the wiring', () => {
  it('test_the_gate_is_handed_to_the_builder', () => {
    // Pillar (a). A refusal predicate nobody passes to the framework is a gate that does not gate —
    // which is what this issue WAS, one layer up. Reading the source is crude and it is the only
    // check available without standing up an agent: the fluent chain has no seam to inspect.
    const chat = readFileSync(
      fileURLToPath(new URL('../../src/chat/chat.ts', import.meta.url)),
      'utf8',
    )
    expect(chat).toContain('.hookApproval({ approve: refuseForeignHook })')
  })
})
