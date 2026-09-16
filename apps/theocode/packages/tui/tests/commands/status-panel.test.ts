/**
 * `/status` answers "what am I actually running?", and it answered it raggedly.
 *
 * Two defects, both visible in the first render of a fresh session and neither covered by a test:
 *
 *   model:     gpt-5.4                     <- one column left of the other seven
 *   sandbox:    sandbox:workspace-write    <- the column label repeated inside the value
 *
 * The alignment was typed into eight template literals by hand, so it was wrong on arrival and
 * would have drifted again on the next label added. The duplication came from filling a column
 * that already says `sandbox:` with `sandboxLabel`, which carries that prefix for the FOOTER —
 * where it sits in a `·`-joined run of bare values and has to say which knob it is.
 */
import { describe, expect, it, vi } from 'vitest'

import { agentsMdRow, statusPanel } from '../../src/commands/command-content.js'
import type { PtysTheInterpreterUses, SessionTheInterpreterUses } from '../../src/commands/command-capabilities.js'

function session(over: Partial<ReturnType<SessionTheInterpreterUses['cfg']>> = {}) {
  return {
    attachImages: vi.fn(),
    effort: () => 'medium' as never,
    setEffort: vi.fn(),
    cfg: () => ({
      modelLabel: 'gpt-5.4',
      sandboxLabel: 'sandbox:workspace-write',
      sandboxDetail: 'workspace-write',
      memory: false,
      ...over,
    }),
    sessionModel: () => undefined,
    setSessionModel: vi.fn(),
    setModel: vi.fn(),
    session: () => 'tui-1',
  } satisfies SessionTheInterpreterUses
}

const ptys = {
  backend: () => ({ activeSessionCount: () => 0, killAll: vi.fn() }),
} as unknown as PtysTheInterpreterUses

/**
 * B-161: the panel reads the rules off disk when it is given no wiring record, so a checkout that
 * has `.claude/rules/` covers a line a clean one does not — and the suite's coverage total then
 * depends on the machine. The record is a parameter for the reason `rulesRow`'s own comment gives;
 * passing it is what keeps both the row and the coverage independent of where the suite runs.
 */
const NO_RULES = {
  // `agentsMd` is required by the type: `agentsMdRow` reads it unguarded, so a record without it
  // crashes the panel. The cast is the file's existing idiom for a partial record; it must still
  // carry every field the panel actually reads.
  agentsMd: { active: [], requested: [], suppressedByTrust: false },
  rules: { count: 0, read: 0 },
} as unknown as Parameters<typeof statusPanel>[4]

const rows = (body: string): readonly string[] => body.split('\n')

/** Where the value starts on a row — the column the panel is supposed to align on. */
function valueColumn(row: string): number {
  const afterLabel = row.indexOf(':') + 1
  return afterLabel + (row.slice(afterLabel).length - row.slice(afterLabel).trimStart().length)
}

describe('the status panel aligns its values on one column', () => {
  it('test_every_row_starts_its_value_at_the_same_column', () => {
    const columns = rows(statusPanel(session(), 'suggest', () => 'tui-1', ptys, NO_RULES).body).map(
      valueColumn,
    )

    expect(
      new Set(columns).size,
      `the value column is ragged: ${JSON.stringify(columns)}. The padding used to be typed into ` +
        'each row by hand, and `model:` sat one column left of the other seven.',
    ).toBe(1)
  })

  it('test_a_longer_label_moves_every_value_together', () => {
    // Anti-vacuity: padding every row to a hard-coded constant would satisfy the test above while
    // still breaking the moment a label outgrows it. This proves the width is COMPUTED.
    const body = statusPanel(session(), 'suggest', () => 'tui-1', ptys, NO_RULES).body
    const widest = Math.max(...rows(body).map((r) => r.indexOf(':')))

    expect(
      valueColumn(rows(body)[0] ?? ''),
      'the value column does not clear the widest label',
    ).toBeGreaterThan(widest)
  })
})

describe('the status panel does not repeat a column label inside its value', () => {
  it('test_the_sandbox_row_names_the_mode_once', () => {
    const sandboxRow = rows(statusPanel(session(), 'suggest', () => 'tui-1', ptys, NO_RULES).body).find((r) =>
      r.startsWith('sandbox:'),
    )

    expect(sandboxRow, 'the sandbox row vanished').toBeDefined()
    expect(
      (sandboxRow ?? '').match(/sandbox:/g)?.length,
      'the row reads `sandbox:    sandbox:workspace-write` — the panel supplies the label as a ' +
        'column, so the value must not carry it too',
    ).toBe(1)
  })

  it('test_the_sandbox_row_still_carries_the_unenforced_warning', () => {
    // The prefix is what was redundant, not the warning. Dropping `⚠ tool-gating` would remove the
    // one thing that tells a user commands are auto-approved with no confinement behind them.
    const row = rows(
      statusPanel(
        session({ sandboxDetail: 'danger-full-access ⚠ tool-gating' }),
        'full-auto',
        () => 'tui-1',
        ptys,
        NO_RULES,
      ).body,
    ).find((r) => r.startsWith('sandbox:'))

    expect(row).toContain('⚠ tool-gating')
  })
})

/**
 * The `AGENTS.md` row, and the state it exists for.
 *
 * `/skills`, `/mcp` and `/hooks` each report what survived the trust gate. The file that most
 * directly steers the model reported nothing — so on an untrusted directory the agent ran without
 * the rules the repository wrote for it and the screen said nothing at all. Codex puts the same
 * fact on its status panel (`Agents.md: <none>`).
 */
describe('the status panel says what is steering the agent', () => {
  const wired = (agentsMd: { active: string[]; requested: string[]; suppressedByTrust: boolean }) =>
    // `rules` belongs here even though these cases are about the agents.md row: without it the
    // panel falls back to reading the rules off disk, and this file's coverage would depend on
    // whether the checkout has `.claude/rules/` (B-161).
    ({ agentsMd, rules: { count: 0, read: 0 } }) as unknown as Parameters<typeof statusPanel>[4]

  const agentsRow = (w?: Parameters<typeof statusPanel>[4]): string =>
    rows(statusPanel(session(), 'suggest', () => 'tui-1', ptys, w).body).find((r) =>
      r.startsWith('agents.md:'),
    ) ?? ''

  it('test_before_the_first_build_it_reports_what_is_on_disk_without_claiming_it_is_loaded', () => {
    // `/status` is what a person runs BEFORE the first turn, which is exactly when there is no
    // wiring record — so the row used to answer `<unknown>` at the only moment it was asked. The
    // walk is a pure read of the disk, so the question does have an answer.
    const row = agentsMdRow(undefined, () => ['/repo/AGENTS.md', '/repo/pkg/AGENTS.md'])

    expect(row, 'the files that would steer the agent are not named').toContain('AGENTS.md')
    expect(row, 'the row does not say the trust gate has not run yet').toContain('not loaded yet')
  })

  it('test_a_repository_with_no_instruction_file_reads_the_same_before_and_after_a_build', () => {
    // Anti-vacuity, and a real equivalence: "the walk found nothing" is the same fact whether or
    // not an agent has been built, so inventing a second wording for it would be noise.
    // The user chain is injected for the same reason the project one is: leaving it ambient makes
    // the result depend on whether the machine running the suite happens to have a
    // `~/.theocode/AGENTS.md`, which is a real file on a real developer's machine.
    expect(agentsMdRow(undefined, () => [], () => [])).toBe('<none>')
  })

  it('test_an_untrusted_directory_is_reported_as_a_REFUSAL_not_an_absence', () => {
    // The case the row exists for. `<none>` here would tell the user their repository has no
    // AGENTS.md, when in fact it has one and the agent was forbidden to read it.
    const row = agentsRow(
      wired({ active: [], requested: ['/repo/AGENTS.md'], suppressedByTrust: true }),
    )

    expect(row, 'a suppressed chain rendered as an empty one').not.toContain('<none>')
    expect(row).toContain('NOT LOADED')
    expect(row, 'the row does not say how many files were ignored').toContain('1 file')
  })

  it('test_a_repository_with_no_instruction_file_reports_none', () => {
    expect(
      agentsMdRow(
        wired({ active: [], requested: [], suppressedByTrust: false }),
        () => [],
        () => [],
      ),
    ).toContain('<none>')
  })

  it('test_loaded_files_are_named', () => {
    const row = agentsRow(
      wired({
        active: ['/repo/AGENTS.md'],
        requested: ['/repo/AGENTS.md'],
        suppressedByTrust: false,
      }),
    )

    expect(row).toContain('AGENTS.md')
    expect(row).not.toContain('<none>')
  })
})

/**
 * The user layer has to be visible — usetheoai-lab/TheoCode#65.
 *
 * A `~/.theocode/AGENTS.md` that silently failed to load is indistinguishable from one being
 * followed, which is the defect this row exists to prevent for the project chain and now has to
 * prevent for the operator's own file too.
 *
 * The untrusted case is the one that changed meaning. `NOT LOADED — directory untrusted` was true
 * when the project chain was all there was; with a user layer it is a lie by omission, because
 * something IS in the prompt. A status line that overstates in the safe direction is still a status
 * line nobody can trust.
 */
describe('agentsMdRow — the user layer', () => {
  it('test_a_user_file_is_named_when_no_project_chain_exists', () => {
    expect(agentsMdRow(undefined, () => [], () => ['/home/u/.theocode/AGENTS.md'])).toContain(
      'user',
    )
  })

  it('test_the_untrusted_row_no_longer_claims_nothing_was_loaded', () => {
    const wired = {
      agentsMd: { suppressedByTrust: true, requested: ['/repo/AGENTS.md'], active: [] },
    } as never
    const row = agentsMdRow(wired, () => [], () => ['/home/u/.theocode/AGENTS.md'])

    expect(row, 'the project chain being ignored still has to be said').toContain('untrusted')
    expect(
      row,
      'something WAS loaded — a row saying otherwise is the defect this test exists for',
    ).toContain('user')
  })

  it('test_no_user_file_leaves_the_existing_rows_untouched', () => {
    // Anti-regression: the common case is an operator with no user file at all, and its wording
    // must not acquire an empty clause.
    expect(agentsMdRow(undefined, () => [], () => [])).toBe('<none>')
    expect(agentsMdRow(undefined, () => ['/repo/AGENTS.md'], () => [])).toContain('on disk')
  })
})
